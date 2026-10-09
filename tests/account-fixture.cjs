// Real isolated account API for legacy UI/desktop regression tests.
// Uses a throwaway MySQL database (credentials from .env) that is dropped on close.
const {createServer}=require('../server.cjs');
const mysql=require('mysql2/promise');
const {randomBytes}=require('node:crypto');
async function accountFixture(){
  const database='notchdrop_test_'+randomBytes(6).toString('hex');
  const server=createServer({database,allowFile:true});
  await server.ready;
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  async function dropDatabase(){
    const conn=await mysql.createConnection({host:process.env.NOTCHDROP_MYSQL_HOST||'127.0.0.1',port:Number(process.env.NOTCHDROP_MYSQL_PORT||3306),user:process.env.NOTCHDROP_MYSQL_USER||'root',password:process.env.NOTCHDROP_MYSQL_PASSWORD||''});
    try { await conn.query(`DROP DATABASE IF EXISTS \`${database}\``); } finally { await conn.end(); }
  }
  return {url,
    async prepare(context,username){
      const response=await fetch(url+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'Regression test password 123!'})});
      const data=await response.json();if(!response.ok)throw new Error(data.error);
      await context.addInitScript(({base,token})=>{
        Object.defineProperty(window,'NOTCHDROP_CONFIG',{value:Object.freeze({apiBaseUrl:base}),writable:false});
        if(!localStorage.getItem('notchdrop.session.v1:'+base))localStorage.setItem('notchdrop.session.v1:'+base,token);
      },{base:url,token:data.token});
    },
    close:async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await dropDatabase();}
  };
}
module.exports={accountFixture};
