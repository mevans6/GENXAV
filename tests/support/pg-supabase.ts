import type { PGlite } from '@electric-sql/pglite';
// Test transport only: real PostgreSQL functions/constraints, with the small
// PostgREST query surface exercised by the reservation handlers.
const identifier = (name:string) => {
  if(!/^[a-z_][a-z0-9_]*$/.test(name))throw Error('Invalid test identifier');
  return `"${name}"`;
};
export function pgSupabase(pg:PGlite) {
  return {
    async rpc(name:string,args:Record<string,unknown>) {
      try {
        const keys=Object.keys(args);
        const result=await pg.query(`select * from public.${identifier(name)}(${keys.map((key,i)=>`${identifier(key)} => $${i+1}`).join(',')})`,Object.values(args));
        const rows=JSON.parse(JSON.stringify(result.rows));
        const scalar=['register_consulting_reservation','record_consulting_payment'].includes(name);
        return {data:scalar?Object.values(rows[0]||{})[0]:rows,error:null};
      }catch(error){return {data:null,error}};
    },
    from(table:string) {
      const values:unknown[]=[];const where:string[]=[];let action='select',data:Record<string,unknown>={},columns='*',conflict='',ignore=false,order='',single=false,maybe=false;
      const param=(value:unknown)=>{values.push(value);return `$${values.length}`};
      const builder:any={
        select(fields='*'){columns=fields==='*'?'*':fields.split(',').map(identifier).join(',');return builder},
        update(value:Record<string,unknown>){action='update';data=value;return builder},
        upsert(value:Record<string,unknown>,options:any={}){action='insert';data=value;conflict=options.onConflict||'id';ignore=options.ignoreDuplicates||false;return builder},
        eq(key:string,value:unknown){where.push(`${identifier(key)}=${param(value)}`);return builder},
        in(key:string,value:unknown[]){where.push(`${identifier(key)}=any(${param(value)})`);return builder},
        is(key:string,value:null){where.push(`${identifier(key)} is null`);return builder},
        order(key:string){order=` order by ${identifier(key)}`;return builder},
        single(){single=true;return builder},maybeSingle(){maybe=true;return builder},
        async then(resolve:any,reject:any){
          try {
            let sql='';const tableName=`public.${identifier(table)}`;
            const clause=where.length?' where '+where.join(' and '):'';
            if(action==='select')sql=`select ${columns} from ${tableName}${clause}${order}`;
            if(action==='update')sql=`update ${tableName} set ${Object.entries(data).map(([key,value])=>`${identifier(key)}=${param(value)}`).join(',')}${clause} returning ${columns}`;
            if(action==='insert'){
              const keys=Object.keys(data);
              sql=`insert into ${tableName}(${keys.map(identifier).join(',')}) values(${keys.map(key=>param(data[key])).join(',')}) on conflict(${conflict.split(',').map(identifier).join(',')}) do ${ignore?'nothing':`update set ${keys.map(key=>`${identifier(key)}=excluded.${identifier(key)}`).join(',')}`} returning *`;
            }
            const result=await pg.query(sql,values);const rows=JSON.parse(JSON.stringify(result.rows));
            if(single&&rows.length!==1)throw Error('Expected single row');
            return resolve({data:single||maybe?rows[0]||null:rows,error:null});
          }catch(error){return resolve({data:null,error})}
        }
      };
      return builder;
    }
  };
}
