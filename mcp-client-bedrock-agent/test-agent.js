// Simple test script for the MCP client with Bedrock Agent

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Replace these with your actual values
const AGENT_ID = 'your-agent-id';
const AGENT_ALIAS_ID = 'your-agent-alias-id';
const MCP_SERVER_SCRIPT = path.join(__dirname, 'node_modules', '@modelcontextprotocol', 'sdk', 'examples', 'weather-server.js');

console.log(`Testing MCP client with Bedrock Agent...`);
console.log(`Agent ID: ${AGENT_ID}`);
console.log(`Agent Alias ID: ${AGENT_ALIAS_ID}`);
console.log(`MCP Server Script: ${MCP_SERVER_SCRIPT}`);

// Run the client
const client = spawn('node', ['build/index.js', MCP_SERVER_SCRIPT, AGENT_ID, AGENT_ALIAS_ID], {
  stdio: 'inherit'
});

client.on('close', (code) => {
  console.log(`Client exited with code ${code}`);
});
