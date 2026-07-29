Wellbound HCHB duplicate agent (Windows on-prem)
================================================

Runs 24/7 on the closet PC. Speaks to LOGSHIP over the LAN. Speaks to AWS
outbound only. Returns true/false — never patient rows.

Quick start (closet PC)
-----------------------
1. Install Python 3.11+ and "ODBC Driver 18 for SQL Server".
2. Copy .env.example → .env and fill OASIS_DB_PASS + HCHB_LINK_PEPPER.
3. PowerShell:
     cd tools\hchb-dup-agent
     .\scripts\run-local.ps1 ping
4. Discover patient columns:
     python discover_schema.py
5. Edit scripts\rebuild_hash_index.py SOURCE SQL, then:
     python scripts\rebuild_hash_index.py
6. Local check (stays on this PC):
     python run_agent.py check --mrn 12345 --last SMITH --first JANE --dob 1980-01-15
7. After AWS bridge is deployed, set HCHB_DUP_BRIDGE_URL + HCHB_DUP_AGENT_TOKEN
   and install the service:
     .\scripts\install-windows-service.ps1

Commands
--------
  python run_agent.py ping
  python run_agent.py check --ssn ... --mrn ... --last ... --first ... --dob ...
  python run_agent.py hash  --ssn ...          (prints digests only)
  python run_agent.py run                     (24/7 loop)

See ../NEXT_STEPS.txt for the full path to CareStream realtime checks.