// Test-only PostgREST transport over a disposable PGlite database. No network or credentials.
module.exports = function personalSqlClient(db) {
 const ident=s=>{ if(!/^[a-z_][a-z_0-9]*$/i.test(s))throw Error('Invalid test identifier'); return '"'+s+'"'; };
 return {
  async rpc(name,args) {
   try { const keys=Object.keys(args);const {rows}=await db.query(`select public.${ident(name)}(${keys.map((k,i)=>`${ident(k)}=>$${i+1}`).join(',')}) result`,keys.map(k=>typeof args[k]==='object'&&args[k]!==null?JSON.stringify(args[k]):args[k]));return {data:rows[0].result,error:null}; }
   catch(e){return {data:null,error:{code:e.code,message:e.message}};}
  },
  from(table) {
   let fields='*',where=[],args=[],mode='select',payload,one=false,order='',limit='';
   const value=v=>{args.push(v);return '$'+args.length;};
   const q={
    select(s='*'){fields=s==='*'?'*':s.split(',').map(s=>ident(s.trim())).join(',');return q;},
    eq(k,v){where.push(`${ident(k)}=${value(v)}`);return q;},
    is(k,v){if(v!==null)throw Error('Only null test filter supported');where.push(`${ident(k)} is null`);return q;},
    in(k,vs){where.push(vs.length?`${ident(k)} in (${vs.map(value).join(',')})`:'false');return q;},
    order(k,o={}){order=` order by ${ident(k)} ${o.ascending===false?'desc':'asc'}`;return q;},
    limit(n){limit=` limit ${Number(n)}`;return q;},
    range(a,b){limit=` limit ${Number(b-a+1)} offset ${Number(a)}`;return q;},
    insert(v){mode='insert';payload=v;return q;},
    update(v){mode='update';payload=v;return q;},
    single(){one=true;return q;},maybeSingle(){one=true;return q;},
    then(resolve,reject){return (async()=>{
     try {
      const filter=where.length?' where '+where.join(' and '):'';
      let sql;
      if(mode==='select')sql=`select ${fields} from public.${ident(table)}${filter}${order}${limit}`;
      else {
       const keys=Object.keys(payload), vals=keys.map(k=>value(typeof payload[k]==='object'&&payload[k]!==null?JSON.stringify(payload[k]):payload[k]));
       sql=mode==='insert'?`insert into public.${ident(table)}(${keys.map(ident).join(',')}) values(${vals.join(',')}) returning ${fields}`
        :`update public.${ident(table)} set ${keys.map((k,i)=>`${ident(k)}=${vals[i]}`).join(',')}${filter} returning ${fields}`;
      }
      const {rows}=await db.query(sql,args);return {data:one?rows[0]??null:rows,error:null};
     }catch(e){return {data:null,error:{code:e.code,message:e.message}};}
    })().then(resolve,reject);}
   };return q;
  }
 };
};
