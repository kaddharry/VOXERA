# Prebuilt tool integrations

The admin Tools workspace has three kinds of capabilities:

1. **Voxera built-ins** — the appointment and reservation tools shipped and executed by Voxera.
2. **Provider-hosted MCP tools** — the provider owns the app authorization and service calls. Voxera stores the MCP endpoint and optional bearer/API key, discovers its tool schemas, lets admins test a selected action, and allows agents to opt into individual actions.
3. **Custom HTTP tools** — a tenant-owned HTTPS endpoint with a saved JSON input schema and optional encrypted credential.

The prebuilt app directory is an integration guide and setup shortcut. It does not claim an app is connected before credentials are configured. Vapi's documented first-party app integrations include Google Calendar, Google Sheets, Slack, GoHighLevel, and Make/n8n integration patterns. Its tools also support custom HTTP/function and MCP connections. For broad app coverage, Zapier MCP exposes provider-managed actions across thousands of apps; a compatible MCP provider performs OAuth and action execution. The discovered schemas and tools are the operational source of truth after connection.

Voxera currently connects to public HTTPS MCP endpoints with no authentication or a static bearer/API-key header. It does not yet implement the MCP OAuth authorization flow or elicitation needed by OAuth-only MCP providers. Use a compatible gateway (for example, a Zapier MCP endpoint with its server URL/credential) or a custom HTTP tool until direct OAuth support is implemented.

## Admin setup flow

1. Open **Tools → Prebuilt apps** and choose the app.
2. Follow its provider setup guide and choose a narrow set of actions.
3. Open **Tools → MCP servers** and paste the provider's HTTPS MCP endpoint. Add a bearer/API key if that server uses one.
4. Connect and discover. Refresh after changing the upstream action list.
5. Use **Test tool** with safe sample arguments. A write action can change the external system.
6. In **Agent Builder → Tools**, opt a specific agent into only the actions it needs, then regenerate its prompt so instructions match its capabilities.

## Research references

- Vapi integrations and connection patterns: https://docs.vapi.ai/tools/integrations
- Vapi Google Calendar setup: https://docs.vapi.ai/tools/google-calendar
- Vapi MCP setup and authentication: https://docs.vapi.ai/tools/mcp
- Vapi reusable tool catalog and tool types: https://docs.vapi.ai/tools
- Zapier MCP coverage and selected app actions: https://help.zapier.com/hc/en-us/articles/48308034391821-What-is-Zapier-MCP
- Zapier's MCP app directory: https://zapier.com/apps/mcp-client-by-zapier/integrations
- Composio MCP sessions and managed auth: https://docs.composio.dev/docs/sessions-via-mcp and https://docs.composio.dev/docs/authentication

## Deployment

Review and apply `sql/migration_v33.sql` for MCP connections and `sql/migration_v34.sql` for custom tools. Set `CREDENTIALS_ENCRYPTION_KEY` before saving credentials. Migration application and provider account authorization are deployment/account setup steps; application code does not silently authorize external accounts.
