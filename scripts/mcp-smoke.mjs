import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/server.js"],
  cwd: projectRoot,
  env: {
    ...process.env,
    AZURE_DEVOPS_ORGANIZATION: "mcp-smoke-test",
    AZURE_DEVOPS_AUTH_MODE: "pat",
    AZURE_DEVOPS_PAT: "mcp-smoke-test-secret",
    AZURE_DEVOPS_ENABLE_WRITE_TOOLS: "false"
  },
  stderr: "pipe"
});
const client = new Client({ name: "azure-devops-mcp-smoke", version: "1.0.0" });

try {
  await client.connect(transport);
  const response = await client.listTools();
  if (response.tools.length !== 28) {
    throw new Error(`Expected 28 tools, received ${response.tools.length}`);
  }
  process.stdout.write(`MCP stdio smoke passed: ${response.tools.length} tools registered.\n`);
} finally {
  await client.close();
}
