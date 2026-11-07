(function exposeGoogleConnectors(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.jarvisGoogleConnectors=api;})(globalThis,function(){
  'use strict';
  const APPS=['gmail','google-calendar','google-contacts','google-drive','google-docs','google-sheets','google-tasks'];
  function normalizeOrigin(value){try{const u=new URL(String(value||''));if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!u.hostname.endsWith('.workers.dev'))return'';return u.origin;}catch{return'';}}
  function normalizeCompanionUrl(value){try{const u=new URL(String(value||''));if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/connect-apps.html'||u.search||u.hash||!u.hostname.endsWith('.ts.net'))return'';return u.href;}catch{return'';}}
  function createGoogleConnectorClient({workerOrigin,enabled=false,fetchImpl=globalThis.fetch,now=Date.now,pollMs=1000,maxWaitMs=45000,requestTimeoutMs=10000}={}){
    const base=normalizeOrigin(workerOrigin);let pairing=null,deviceToken='',deviceId='',expiresAt=0,apps=[];
    const request=async(path,{method='GET',body,token=''}={})=>{
      if(!enabled||!base)throw new Error('Google Apps relay is not configured.');
      const diagnosticPath=path.replace(/^\/v1\/hud\/commands\/[a-f0-9]{40}$/, '/v1/hud/commands/:jobId');
      const label=`Google Apps ${method} ${diagnosticPath}`;
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),requestTimeoutMs);
      let r,data;
      try {
        r=await fetchImpl(`${base}${path}`,{method,signal:controller.signal,mode:'cors',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',headers:{Accept:'application/json',...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
        try{data=await r.json();}catch{if(controller.signal.aborted)throw new Error('timeout');data=null;}
      } catch {
        const reason=controller.signal.aborted?'timed out':globalThis.navigator?.onLine===false?'failed because this device is offline':'could not reach the relay; check network, DNS, or browser CORS restrictions';
        throw new Error(`${label} ${reason}. Relay: ${new URL(base).hostname}. Retry the request when connectivity returns.`);
      } finally {clearTimeout(timer);}
      if(!r.ok){if(r.status===401)clear();const hint=r.status===401?'Authorization expired. Pair again on your phone.':r.status===403?'HUD origin or authorization denied.':r.status===410?'Pairing or request expired or already used. Start fresh phone approval.':r.status===429?'Too many requests. Wait before retrying.':r.status>=500?'Relay unavailable or not configured. Try again later.':'Relay request rejected.';const e=new Error(`${label}: HTTP ${r.status}. ${hint}`);e.status=r.status;throw e;}
      if(!data||typeof data!=='object'||Array.isArray(data))throw new Error(`${label}: relay returned invalid JSON.`);
      return data;
    };
    const clear=()=>{pairing=null;deviceToken='';deviceId='';expiresAt=0;apps=[];};
    return Object.freeze({
      available:()=>Boolean(enabled&&base),paired:()=>Boolean(deviceToken&&expiresAt>now()),get apps(){return [...apps];},get expiresAt(){return expiresAt;},clear,
      startPairing:async(requested=APPS)=>{if(!enabled||!base)throw new Error('Google Apps relay is not configured.');const selected=[...new Set(requested)];if(!selected.length||selected.some(app=>!APPS.includes(app)))throw new Error('Choose valid Google apps.');clear();const value=await request('/v1/hud/pairings',{method:'POST',body:{apps:selected}});if(typeof value.pairingId!=='string'||!/^[a-f0-9]{48}$/.test(value.pairingId)||typeof value.pairingAlias!=='string'||!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(value.pairingAlias)||typeof value.pollSecret!=='string'||!/^[a-f0-9]{64}$/.test(value.pollSecret)||!/^[0-9]{8}$/.test(value.userCode)||!Number.isFinite(value.expiresAt)||value.expiresAt<=now()||value.expiresAt>now()+210000)throw new Error('Relay returned an invalid or overlong pairing challenge.');pairing={id:value.pairingId,alias:value.pairingAlias,poll:value.pollSecret,code:value.userCode,expiresAt:value.expiresAt};return {pairingAlias:pairing.alias,userCode:pairing.code,expiresAt:pairing.expiresAt};},
      pollPairing:async()=>{if(!pairing||pairing.expiresAt<=now()){clear();throw new Error('Pairing expired. Start a new request.');}const value=await request('/v1/hud/pairings/poll',{method:'POST',body:{pairingId:pairing.id,pollSecret:pairing.poll}});if(value.status==='pending')return {paired:false};if(value.status!=='paired'||typeof value.accessToken!=='string'||!/^[a-f0-9]{64}$/.test(value.accessToken)||typeof value.deviceId!=='string'||!/^hud_[a-f0-9]{32}$/.test(value.deviceId)||!Number.isFinite(value.expiresAt)||value.expiresAt<=now()||!Array.isArray(value.apps)||value.apps.some(app=>!APPS.includes(app))){clear();throw new Error('Relay returned an invalid device authorization.');}deviceToken=value.accessToken;deviceId=value.deviceId;expiresAt=value.expiresAt;apps=[...value.apps];pairing=null;return {paired:true,apps:[...apps],expiresAt};},
      runCommand:async(message)=>{if(!deviceToken||expiresAt<=now()){clear();throw new Error('Glasses authorization expired. Pair again on the phone.');}const command=String(message||'').trim();if(!command||command.length>1200)throw new Error('Enter a command of 1 to 1,200 characters.');const queued=await request('/v1/hud/commands',{method:'POST',body:{message:command},token:deviceToken});if(typeof queued.jobId!=='string'||!/^[a-f0-9]{40}$/.test(queued.jobId))throw new Error('Relay returned an invalid command receipt.');const end=now()+maxWaitMs;while(now()<end){const result=await request(`/v1/hud/commands/${queued.jobId}`,{token:deviceToken});if(result.status==='complete'&&typeof result.result?.content==='string')return result.result.content.slice(0,5000);await new Promise(resolve=>setTimeout(resolve,pollMs));}throw new Error('Google lookup is taking too long. Try again.');},
    });
  }
  return {APPS,normalizeOrigin,normalizeCompanionUrl,createGoogleConnectorClient};
});
