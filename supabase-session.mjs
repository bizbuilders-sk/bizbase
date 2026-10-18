export function createSupabaseSession({getBackend,setBackend,fetcher=fetch,now=()=>Date.now()}){
  let renewal=null;
  const expired=()=>{const current=getBackend();if(current.connected)setBackend({...current,sessionExpired:true,password:''});throw Error('Your staff session expired. Reconnect in Settings.');};
  async function renew(){
    if(renewal)return renewal;
    const original=getBackend();if(!original.refreshToken)return expired();
    renewal=(async()=>{
      let response;
      try{response=await fetcher(`${original.url.replace(/\/$/,'')}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:original.key,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:original.refreshToken})});}
      catch{throw Error('Could not renew the staff session. Check your connection and retry.');}
      const current=getBackend();
      if(!current.connected||current.url!==original.url||current.refreshToken!==original.refreshToken)throw Error('The connection changed while renewing. Retry with the current connection.');
      if(!response.ok)return expired();
      const session=await response.json();if(!session.access_token)return expired();
      setBackend({...current,password:'',token:session.access_token,refreshToken:session.refresh_token||current.refreshToken,expiresAt:Math.floor(now()/1000)+Number(session.expires_in||3600),sessionExpired:false});
    })();
    try{return await renewal;}finally{renewal=null;}
  }
  async function request(path,options={}){
    let current=getBackend();if(!current.connected)throw Error('Connect Supabase in Settings.');
    if(current.refreshToken&&current.expiresAt&&current.expiresAt<=Math.floor(now()/1000)+45)await renew();
    const send=()=>{const b=getBackend();return fetcher(`${b.url.replace(/\/$/,'')}/rest/v1/${path}`,{...options,headers:{apikey:b.key,Authorization:`Bearer ${b.token}`,'Content-Type':'application/json',Prefer:'return=representation',...(options.headers||{})}});};
    const usedToken=getBackend().token;let response=await send();
    if(response.status===401){
      if(getBackend().token===usedToken)await renew();
      if(!getBackend().connected)throw Error('Supabase disconnected.');
      response=await send();if(response.status===401)return expired();
    }
    if(!response.ok)throw Error((await response.text()).slice(0,240));
    if(response.status===204)return null;const text=await response.text();return text?JSON.parse(text):null;
  }
  return {request};
}
