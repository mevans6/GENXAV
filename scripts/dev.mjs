import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
process.loadEnvFile?.('.env.local');
const {default:consulting}=await import('../api/consulting.js');
const {default:intake}=await import('../api/intake.js');
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost:3000');if(url.pathname.startsWith('/api/consulting/'))return await consulting(req,res);if(url.pathname==='/api/intake')return await intake(req,res);const file=url.pathname==='/'?'index.html':url.pathname==='/consulting'?'consulting.html':url.pathname==='/consulting/terms'?'consulting-terms.html':url.pathname==='/consulting/refunds'?'consulting-refunds.html':url.pathname.startsWith('/consulting/')?'consulting-shell.html':url.pathname.slice(1);const target=path.resolve('dist',file);if(!target.startsWith(path.resolve('dist')+'/')){res.statusCode=403;return res.end()}const body=await readFile(target);res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(body)}catch{res.statusCode=404;res.end('Not found')}}).listen(3000,'127.0.0.1',()=>console.log('Gen X AV preview: http://localhost:3000'));
