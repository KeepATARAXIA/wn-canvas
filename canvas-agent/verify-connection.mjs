import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
const client = new Client({name:'canvas-connection-check', version:'1.0.0'});
const transport = new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./dist/index.js',import.meta.url)),'mcp'],stderr:'pipe'});
try {
  await client.connect(transport);
  if(process.argv[2]==='list') {
    const result=await client.listTools();
    console.log(JSON.stringify({count:result.tools.length,createNodeSchema:result.tools.find(t=>t.name==='canvas_create_node').inputSchema}));
  } else {
    const result=await client.callTool({name:process.argv[2]||'canvas_get_state',arguments:JSON.parse(process.argv[3]||'{}')});
    console.log(JSON.stringify(result));
  }
} finally { await client.close(); }
