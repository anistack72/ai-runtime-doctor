import http from 'node:http';
import { once } from 'node:events';
import { diagnose } from './index.mjs';
import { formatReport } from './support.mjs';
const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({models:req.url==='/api/tags'?[{name:'synthetic-demo-model-q4',size:1024*1024,details:{family:'fixture',quantization_level:'Q4_K_M'}}]:[]}));}).listen(0,'127.0.0.1');
await once(server,'listening');
try {const report=await diagnose({runtime:'ollama',endpoint:`http://127.0.0.1:${server.address().port}`});report.summary='SYNTHETIC FIXTURE DEMO — not an installed AI model. '+report.summary;console.log(formatReport(report,process.argv[2]??'text'));}
finally {server.closeAllConnections();server.close();}
