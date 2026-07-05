#!/usr/bin/env node
/**
 * provision-aws.js — one-shot, idempotent provisioning of the wellbound-api
 * stack (IAM roles, Lambdas, API Gateway HTTP API). Mirrors services/DEPLOY.md
 * but executable anywhere with admin AWS credentials in the environment.
 *
 * Usage:
 *   AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… AWS_REGION=us-east-2 \
 *   INTERNAL_API_KEY=… node services/provision-aws.js
 *
 * Prints the API URL at the end. Safe to re-run: existing resources are
 * updated (code/env), not duplicated.
 */

import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IAMClient, CreateRoleCommand, AttachRolePolicyCommand, PutRolePolicyCommand, GetRoleCommand } from '@aws-sdk/client-iam';
import {
  LambdaClient, CreateFunctionCommand, UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand, GetFunctionCommand, AddPermissionCommand, waitUntilFunctionUpdatedV2,
} from '@aws-sdk/client-lambda';
import {
  ApiGatewayV2Client, CreateApiCommand, GetApisCommand, CreateIntegrationCommand,
  GetIntegrationsCommand, CreateRouteCommand, GetRoutesCommand, CreateStageCommand, GetStagesCommand,
} from '@aws-sdk/client-apigatewayv2';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGION = process.env.AWS_REGION || 'us-east-2';
const ACCT = '493042495477';
const CLUSTER_ARN = `arn:aws:rds:${REGION}:${ACCT}:cluster:wellbound-prod`;
const SECRET_ARN = process.env.WB_SECRET_ARN
  || 'arn:aws:secretsmanager:us-east-2:493042495477:secret:rds!cluster-e0e32747-6c01-4a6d-80ae-0644fa7d5b01-7DokQe';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || crypto.randomBytes(32).toString('hex');
const CLERK_ISSUER = 'https://clerk.wellboundcarestream.com';

const iam = new IAMClient({ region: REGION });
const lambda = new LambdaClient({ region: REGION });
const apigw = new ApiGatewayV2Client({ region: REGION });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TRUST = JSON.stringify({
  Version: '2012-10-17',
  Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
});

async function ensureRole(name, inlinePolicy) {
  let created = false;
  try {
    await iam.send(new GetRoleCommand({ RoleName: name }));
  } catch {
    await iam.send(new CreateRoleCommand({ RoleName: name, AssumeRolePolicyDocument: TRUST }));
    created = true;
  }
  await iam.send(new AttachRolePolicyCommand({
    RoleName: name,
    PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
  }));
  await iam.send(new PutRolePolicyCommand({
    RoleName: name, PolicyName: 'service-access', PolicyDocument: JSON.stringify(inlinePolicy),
  }));
  if (created) { console.log(`IAM role ${name} created — waiting for propagation…`); await sleep(12000); }
  else console.log(`IAM role ${name} OK`);
  return `arn:aws:iam::${ACCT}:role/${name}`;
}

async function ensureFunction({ name, roleArn, zipPath, env, memory }) {
  const code = fs.readFileSync(zipPath);
  try {
    await lambda.send(new GetFunctionCommand({ FunctionName: name }));
    await lambda.send(new UpdateFunctionCodeCommand({ FunctionName: name, ZipFile: code }));
    await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: name });
    await lambda.send(new UpdateFunctionConfigurationCommand({
      FunctionName: name, Environment: { Variables: env }, Timeout: 29, MemorySize: memory,
    }));
    await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: name });
    console.log(`Lambda ${name} updated`);
  } catch (err) {
    if (err.name !== 'ResourceNotFoundException') throw err;
    for (let attempt = 0; ; attempt++) {
      try {
        await lambda.send(new CreateFunctionCommand({
          FunctionName: name, Runtime: 'nodejs20.x', Handler: 'src/handler.handler',
          Role: roleArn, Code: { ZipFile: code }, Timeout: 29, MemorySize: memory,
          Environment: { Variables: env },
        }));
        break;
      } catch (e) {
        if (e.message?.includes('assume') && attempt < 5) { await sleep(8000); continue; }
        throw e;
      }
    }
    console.log(`Lambda ${name} created`);
  }
  return `arn:aws:lambda:${REGION}:${ACCT}:function:${name}`;
}

async function main() {
  // ── 1. Build zips ──────────────────────────────────────────────────────────
  console.log('Building bundles…');
  execSync('node build.js', { cwd: path.join(HERE, 'wellbound-api'), stdio: 'inherit' });
  execSync('npm run build', { cwd: path.join(HERE, 'files-api'), stdio: 'inherit' });

  // ── 2. IAM ─────────────────────────────────────────────────────────────────
  const apiRole = await ensureRole('wellbound-api-role', {
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: ['rds-data:ExecuteStatement', 'rds-data:BatchExecuteStatement', 'rds-data:BeginTransaction', 'rds-data:CommitTransaction', 'rds-data:RollbackTransaction'], Resource: CLUSTER_ARN },
      { Effect: 'Allow', Action: 'secretsmanager:GetSecretValue', Resource: SECRET_ARN },
    ],
  });
  const filesRole = await ensureRole('files-api-role', {
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: ['s3:PutObject', 's3:GetObject'], Resource: 'arn:aws:s3:::wellbound-prod-store/*' },
      { Effect: 'Allow', Action: ['kms:GenerateDataKey', 'kms:Decrypt'], Resource: '*', Condition: { StringEquals: { 'kms:ViaService': `s3.${REGION}.amazonaws.com` } } },
    ],
  });

  // ── 3. Lambdas ─────────────────────────────────────────────────────────────
  const apiFnArn = await ensureFunction({
    name: 'wellbound-api', roleArn: apiRole, memory: 512,
    zipPath: path.join(HERE, 'wellbound-api/dist/wellbound-api.zip'),
    env: {
      WB_CLUSTER_ARN: CLUSTER_ARN, WB_SECRET_ARN: SECRET_ARN, WB_DATABASE: 'wellbound',
      CLERK_ISSUER, INTERNAL_API_KEY,
    },
  });
  const stagingFnArn = await ensureFunction({
    name: 'wellbound-api-staging', roleArn: apiRole, memory: 512,
    zipPath: path.join(HERE, 'wellbound-api/dist/wellbound-api.zip'),
    env: {
      WB_CLUSTER_ARN: CLUSTER_ARN, WB_SECRET_ARN: SECRET_ARN, WB_DATABASE: 'wellbound_staging',
      CLERK_ISSUER, INTERNAL_API_KEY,
    },
  });
  const filesFnArn = await ensureFunction({
    name: 'files-api', roleArn: filesRole, memory: 256,
    zipPath: path.join(HERE, 'files-api/dist/files-api.zip'),
    env: {
      WB_BUCKET: 'wellbound-prod-store', CLERK_ISSUER, INTERNAL_API_KEY, SIGN_TTL_SECONDS: '600',
    },
  });

  // ── 4. API Gateway (one per environment) ───────────────────────────────────
  async function ensureApi(name, dataFnArn) {
    const apis = await apigw.send(new GetApisCommand({ MaxResults: '100' }));
    let api = (apis.Items || []).find((a) => a.Name === name);
    if (!api) {
      api = await apigw.send(new CreateApiCommand({ Name: name, ProtocolType: 'HTTP' }));
      console.log(`API ${name} created: ${api.ApiId}`);
    } else {
      console.log(`API ${name} OK: ${api.ApiId}`);
    }
    const apiId = api.ApiId;

    const ints = await apigw.send(new GetIntegrationsCommand({ ApiId: apiId, MaxResults: '100' }));
    async function ensureIntegration(fnArn) {
      const existing = (ints.Items || []).find((i) => i.IntegrationUri === fnArn);
      if (existing) return existing.IntegrationId;
      const int = await apigw.send(new CreateIntegrationCommand({
        ApiId: apiId, IntegrationType: 'AWS_PROXY', IntegrationUri: fnArn, PayloadFormatVersion: '2.0',
      }));
      return int.IntegrationId;
    }
    const dataInt = await ensureIntegration(dataFnArn);
    const filesInt = await ensureIntegration(filesFnArn);

    const routes = await apigw.send(new GetRoutesCommand({ ApiId: apiId, MaxResults: '100' }));
    const have = new Set((routes.Items || []).map((r) => r.RouteKey));
    const wanted = [
      ['PUT /files/upload/{proxy+}', filesInt],
      ['PUT /files/upload-tickets/{proxy+}', filesInt],
      ['GET /files/sign', filesInt],
      ['ANY /{proxy+}', dataInt],
    ];
    for (const [key, target] of wanted) {
      if (have.has(key)) continue;
      await apigw.send(new CreateRouteCommand({ ApiId: apiId, RouteKey: key, Target: `integrations/${target}` }));
      console.log(`  route ${key}`);
    }

    const stages = await apigw.send(new GetStagesCommand({ ApiId: apiId }));
    if (!(stages.Items || []).find((s) => s.StageName === '$default')) {
      await apigw.send(new CreateStageCommand({ ApiId: apiId, StageName: '$default', AutoDeploy: true }));
    }

    for (const fnArn of [dataFnArn, filesFnArn]) {
      const fnName = fnArn.split(':').pop();
      try {
        await lambda.send(new AddPermissionCommand({
          FunctionName: fnName, StatementId: `apigw-${apiId}`, Action: 'lambda:InvokeFunction',
          Principal: 'apigateway.amazonaws.com',
          SourceArn: `arn:aws:execute-api:${REGION}:${ACCT}:${apiId}/*`,
        }));
      } catch (e) { if (e.name !== 'ResourceConflictException') throw e; }
    }
    return `https://${apiId}.execute-api.${REGION}.amazonaws.com`;
  }

  const prodUrl = await ensureApi('wellbound-api', apiFnArn);
  const stagingUrl = await ensureApi('wellbound-api-staging', stagingFnArn);

  console.log('\n──────────────────────────────────────────────');
  console.log(`PROD    API: ${prodUrl}`);
  console.log(`STAGING API: ${stagingUrl}`);
  console.log(`FILES  (both): {api}/files/…`);
  console.log(`INTERNAL_API_KEY: ${INTERNAL_API_KEY}`);
  console.log('Store the key in a password manager; set it on the CF workers as a secret.');
}

main().catch((err) => { console.error(err); process.exit(1); });
