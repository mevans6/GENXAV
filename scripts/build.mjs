import {build} from 'esbuild';
import {mkdir,cp,rm,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const routes=[];
async function scan(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await scan(file);else if(entry.name==='route.ts')routes.push(file)}}
await scan('server/routes');
routes.sort((a,b)=>(a.match(/\[/g)||[]).length-(b.match(/\[/g)||[]).length || b.length-a.length);
let router="import {adapt} from './adapter';\n";
routes.forEach((file,index)=>{router+=`import * as route${index} from './${file.slice(7)}';\n`});
router+="const routes=[\n";
routes.forEach((file,index)=>{const route=file.slice('server/routes/'.length,-'/route.ts'.length);const keys=[];const pattern=route.split('/').map(s=>s.startsWith('[')?(keys.push(s.slice(1,-1)),'([^/]+)'):s).join('/');router+=`{pattern:new RegExp('^${pattern}$'),keys:${JSON.stringify(keys)},handlers:route${index}},\n`});
router+=`];\nexport default adapt(async(request)=>{const url=new URL(request.url);const route=url.searchParams.get('route')||url.pathname.replace(/^\\/api\\/consulting\\/?/,'');for(const item of routes){const match=item.pattern.exec(route);if(!match)continue;const handler=item.handlers[request.method];if(!handler)return Response.json({error:'Method not allowed'},{status:405,headers:{Allow:Object.keys(item.handlers).filter(k=>/^(GET|POST|DELETE)$/.test(k)).join(', ')}});return handler(request,{params:Promise.resolve(Object.fromEntries(item.keys.map((key,i)=>[key,match[i+1]])))});}return Response.json({error:'Not found'},{status:404});});\nexport const config={api:{bodyParser:false}};\n`;
await writeFile('server/router.ts',router);
await rm('dist',{recursive:true,force:true});await mkdir('dist',{recursive:true});
for(const file of ['index.html','privacy.html','styles.css','script.js','navigation.js','consulting.html','consulting.css','consulting-shell.html','consulting-terms.html','consulting-refunds.html','assets'])await cp(file,`dist/${file}`,{recursive:true});
const aliases={'@lib':path.resolve('server/lib'),'@cookies':path.resolve('server/cookies.ts'),'next/headers':path.resolve('server/cookies.ts')};
await build({entryPoints:['server/router.ts'],outfile:'server/build/consulting.js',bundle:true,platform:'node',format:'esm',packages:'external',alias:aliases});
await build({entryPoints:['server/integrator.ts'],outfile:'server/build/integrator.js',bundle:true,platform:'node',format:'esm',packages:'external',alias:aliases});
await build({entryPoints:['client/app.tsx'],outfile:'dist/consulting-app.js',bundle:true,minify:true,platform:'browser',jsx:'automatic',alias:{...aliases,'next/link':path.resolve('client/compat.tsx'),'next/image':path.resolve('client/image.tsx'),'next/navigation':path.resolve('client/compat.tsx')},define:{'process.env':'{}'}});
