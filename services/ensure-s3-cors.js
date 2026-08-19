#!/usr/bin/env node
/**
 * Apply browser CORS on wellbound-prod-store so CareStream can PUT files
 * directly to a presigned S3 URL (and GET bytes for EMR packets).
 *
 * Usage (admin AWS creds):
 *   AWS_REGION=us-east-2 node services/ensure-s3-cors.js
 */
import { S3Client, PutBucketCorsCommand } from '@aws-sdk/client-s3';

const REGION = process.env.AWS_REGION || 'us-east-2';
const BUCKET = process.env.WB_BUCKET || 'wellbound-prod-store';

const CORS = {
  CORSRules: [{
    AllowedOrigins: [
      'https://wellboundcarestream.com',
      'https://www.wellboundcarestream.com',
      'https://support.wellboundcarestream.com',
      'https://field-support.wellboundcarestream.com',
      'http://localhost:5173',
      'http://localhost:5174',
    ],
    AllowedMethods: ['GET', 'PUT', 'HEAD'],
    AllowedHeaders: ['*'],
    ExposeHeaders: ['ETag', 'x-amz-request-id', 'x-amz-server-side-encryption'],
    MaxAgeSeconds: 3600,
  }],
};

const s3 = new S3Client({ region: REGION });
await s3.send(new PutBucketCorsCommand({ Bucket: BUCKET, CORSConfiguration: CORS }));
console.log(`CORS applied on s3://${BUCKET}`);
