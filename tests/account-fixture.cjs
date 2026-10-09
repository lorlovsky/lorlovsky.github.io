// Real isolated account API for legacy UI/desktop regression tests.
const {createServer}=require('../server.cjs');
async function accountFixture(){
  const server=createServer({database:':memory:',allowFile:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  return {url,
    async prepare(context,username){
      const response=await fetch(url+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'Regression test password 123!'})});
      const data=await response.json();if(!response.ok)throw new Error(data.error);
      await context.addInitScript(({base,token})=>{
        Object.defineProperty(window,'NOTCHDROP_CONFIG',{value:Object.freeze({apiBaseUrl:base}),writable:false});
        if(!localStorage.getItem('notchdrop.session.v1:'+base))localStorage.setItem('notchdrop.session.v1:'+base,token);
      },{base:url,token:data.token});
    },
    close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})
  };
}
module.exports={accountFixture};
