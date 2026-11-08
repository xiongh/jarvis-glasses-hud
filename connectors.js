(function exposeGoogleConnectors(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.jarvisGoogleConnectors=api;})(globalThis,function(){
  'use strict';
  const APPS=['gmail','google-calendar','google-contacts','google-drive','google-docs','google-sheets','google-tasks'];
  const DEVICE_TTL_MS=30*24*60*60*1000;
  function commandHelp(value){
    const command=String(value||'').trim().replace(/^jarvis\b[\s,.:;-]*/i,'');
    const lower=command.toLowerCase();
    if(/^(?:hi|hello|hey)(?:\s+jarvis)?[!?.\s]*$/i.test(command))return 'Hello. I can read your connected Gmail, Calendar, Contacts, Drive, Docs, Sheets, and Tasks. Try “show my latest five emails” or “what is on my calendar?”';
    if(/\b(?:first|oldest|earliest)\b[\s\w]*\b(?:e-?mails?|gmail|inbox|mail|messages?)\b|\b(?:e-?mails?|gmail|inbox|mail|messages?)\b[\s\w]*\b(?:first|oldest|earliest)\b/i.test(lower))return '“First email” could mean newest or oldest. Say “show my latest five emails” for newest messages. Oldest-message search is not supported, so JARVIS will not substitute newest messages silently.';
    if(!/\b(?:calendar|meetings?|appointments?|events?|e-?mails?|gmail|inbox|mail|messages?|contact|contacts|phone number|email address|spreadsheets?|sheets?|documents?|docs?|drive|file|files|folder|task|tasks|to-do|todo|reminder)\b/i.test(lower))return 'I can help with read-only Gmail, Calendar, Contacts, Drive, Docs, Sheets, and Tasks requests. Try “show my latest five emails” or “what is on my calendar?”';
    return '';
  }
  function indexedDbSessionStore(indexedDBImpl=globalThis.indexedDB){
    let opening;
    const open=()=>{if(!indexedDBImpl)return Promise.reject(new Error('storage unavailable'));if(!opening)opening=new Promise((resolve,reject)=>{const req=indexedDBImpl.open('jarvis-google-device-session',1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('sessions'))req.result.createObjectStore('sessions',{keyPath:'workerOrigin'});};req.onsuccess=()=>resolve(req.result);req.onerror=req.onblocked=()=>reject(new Error('storage unavailable'));});return opening;};
    const op=async(mode,action)=>{const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('sessions',mode),request=action(tx.objectStore('sessions'));tx.oncomplete=()=>resolve(request?.result);tx.onerror=tx.onabort=()=>reject(new Error('storage unavailable'));});};
    return {read:key=>op('readonly',s=>s.get(key)),write:value=>op('readwrite',s=>s.put(value)),remove:key=>op('readwrite',s=>s.delete(key))};
  }
  function normalizeOrigin(value){try{const u=new URL(String(value||''));if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!u.hostname.endsWith('.workers.dev'))return'';return u.origin;}catch{return'';}}
  function normalizeCompanionUrl(value){try{const u=new URL(String(value||''));if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/connect-apps.html'||u.search||u.hash||!u.hostname.endsWith('.ts.net'))return'';return u.href;}catch{return'';}}
  function createGoogleConnectorClient({workerOrigin,enabled=false,fetchImpl=globalThis.fetch,now=Date.now,pollMs=1000,maxWaitMs=45000,requestTimeoutMs=10000,storage=indexedDbSessionStore()}={}){
    const base=normalizeOrigin(workerOrigin);let pairing=null,deviceToken='',deviceId='',renewalToken='',deviceExpiresAt=0,expiresAt=0,apps=[],persistent=false,renewInFlight=null,restoreInFlight=null;
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
      if(!r.ok){const hint=r.status===401?'Authorization expired or revoked. Restore the saved approval or pair again on your phone.':r.status===403?'HUD origin or authorization denied.':r.status===410?'Pairing or request expired or already used. Start fresh phone approval.':r.status===429?'Too many requests. Wait before retrying.':r.status>=500?'Relay unavailable or not configured. Try again later.':'Relay request rejected.';const e=new Error(`${label}: HTTP ${r.status}. ${hint}`);e.status=r.status;throw e;}
      if(!data||typeof data!=='object'||Array.isArray(data))throw new Error(`${label}: relay returned invalid JSON.`);
      return data;
    };
    const persist=async()=>{try{await storage.write({workerOrigin:base,deviceId,renewalToken,deviceExpiresAt});persistent=true;return true;}catch{persistent=false;return false;}};
    // Do not let a stale tab erase a replacement capability saved by a newer
    // renewal. This matters because renewal capabilities are single-use.
    const clear=()=>{const savedRenewalToken=renewalToken;pairing=null;deviceToken='';deviceId='';renewalToken='';deviceExpiresAt=0;expiresAt=0;apps=[];persistent=false;void (async()=>{try{const saved=await storage.read(base);if(!savedRenewalToken||saved?.renewalToken===savedRenewalToken)await storage.remove(base);}catch{}})();};
    const acceptRenewal=async value=>{if(typeof value.deviceId!=='string'||!/^hud_[a-f0-9]{32}$/.test(value.deviceId)||typeof value.accessToken!=='string'||!/^[a-f0-9]{64}$/.test(value.accessToken)||typeof value.renewalToken!=='string'||!/^[a-f0-9]{64}$/.test(value.renewalToken)||!Number.isFinite(value.expiresAt)||value.expiresAt<=now()||value.expiresAt>now()+910000||!Number.isFinite(value.deviceExpiresAt)||value.deviceExpiresAt<value.expiresAt||value.deviceExpiresAt>now()+DEVICE_TTL_MS||!Array.isArray(value.apps)||!value.apps.length||value.apps.some(app=>!APPS.includes(app)))throw new Error('Relay returned an invalid device renewal.');deviceId=value.deviceId;deviceToken=value.accessToken;renewalToken=value.renewalToken;expiresAt=value.expiresAt;deviceExpiresAt=value.deviceExpiresAt;apps=[...value.apps];await persist();return true;};
    const renew=async()=>{
      if(renewInFlight)return renewInFlight;
      renewInFlight=(async()=>{
        if(!deviceId||!renewalToken||deviceExpiresAt<=now()){clear();return false;}
        try{return await acceptRenewal(await request('/v1/hud/renew',{method:'POST',body:{deviceId,renewalToken}}));}
        catch(error){if(error.status===401){clear();return false;}throw error;}
      })().finally(()=>{renewInFlight=null;});
      return renewInFlight;
    };
    return Object.freeze({
      available:()=>Boolean(enabled&&base),paired:()=>Boolean(deviceToken&&expiresAt>now()),get apps(){return [...apps];},get expiresAt(){return expiresAt;},get persistent(){return persistent;},commandHelp,clear,
      restore:async()=>{
        if(restoreInFlight)return restoreInFlight;
        restoreInFlight=(async()=>{
          const validSaved=value=>value&&value.workerOrigin===base&&typeof value.deviceId==='string'&&/^hud_[a-f0-9]{32}$/.test(value.deviceId)&&typeof value.renewalToken==='string'&&/^[a-f0-9]{64}$/.test(value.renewalToken)&&Number.isFinite(value.deviceExpiresAt)&&value.deviceExpiresAt>now()&&value.deviceExpiresAt<=now()+DEVICE_TTL_MS;
          const load=async()=>{let saved;try{saved=await storage.read(base);}catch{return null;}if(!validSaved(saved))return null;deviceId=saved.deviceId;renewalToken=saved.renewalToken;deviceExpiresAt=saved.deviceExpiresAt;return saved;};
          let saved=await load();
          if(!saved){try{const present=await storage.read(base);if(present)clear();return{paired:false,storageAvailable:true};}catch{return{paired:false,storageAvailable:false};}}
          const attemptedToken=saved.renewalToken;
          try{
            if(await renew())return{paired:true,storageAvailable:true,apps:[...apps]};
            // Another tab may have won the single-use renewal race. Re-read once
            // before showing a re-pair prompt; clear() never deletes a newer token.
            saved=await load();
            if(saved&&saved.renewalToken!==attemptedToken)return{paired:false,storageAvailable:true,transient:true};
            return{paired:false,storageAvailable:true};
          }catch{return{paired:false,storageAvailable:true,transient:true};}
        })().finally(()=>{restoreInFlight=null;});
        return restoreInFlight;
      },
      startPairing:async(requested=APPS)=>{if(!enabled||!base)throw new Error('Google Apps relay is not configured.');const selected=[...new Set(requested)];if(!selected.length||selected.some(app=>!APPS.includes(app)))throw new Error('Choose valid Google apps.');clear();const value=await request('/v1/hud/pairings',{method:'POST',body:{apps:selected}});if(typeof value.pairingId!=='string'||!/^[a-f0-9]{48}$/.test(value.pairingId)||typeof value.pairingAlias!=='string'||!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(value.pairingAlias)||typeof value.pollSecret!=='string'||!/^[a-f0-9]{64}$/.test(value.pollSecret)||!/^[0-9]{8}$/.test(value.userCode)||!Number.isFinite(value.expiresAt)||value.expiresAt<=now()||value.expiresAt>now()+210000)throw new Error('Relay returned an invalid or overlong pairing challenge.');pairing={id:value.pairingId,alias:value.pairingAlias,poll:value.pollSecret,code:value.userCode,expiresAt:value.expiresAt};return {pairingAlias:pairing.alias,userCode:pairing.code,expiresAt:pairing.expiresAt};},
      pollPairing:async()=>{if(!pairing||pairing.expiresAt<=now()){clear();throw new Error('Pairing expired. Start a new request.');}const value=await request('/v1/hud/pairings/poll',{method:'POST',body:{pairingId:pairing.id,pollSecret:pairing.poll}});if(value.status==='pending')return {paired:false};if(value.status!=='paired'){clear();throw new Error('Relay returned an invalid device authorization.');}pairing=null;await acceptRenewal(value);return {paired:true,apps:[...apps],expiresAt,deviceExpiresAt,persistent};},
      runCommand:async(message)=>{const command=String(message||'').trim(),help=commandHelp(command);if(help)return help;if(!deviceToken||expiresAt<=now()){if(!await renew())throw new Error('Glasses authorization expired. Restore the saved approval or pair again on the phone.');}if(!command||command.length>1200)throw new Error('Enter a command of 1 to 1,200 characters.');let queued;try{queued=await request('/v1/hud/commands',{method:'POST',body:{message:command},token:deviceToken});}catch(error){if(error.status!==401||!await renew())throw error;queued=await request('/v1/hud/commands',{method:'POST',body:{message:command},token:deviceToken});}if(typeof queued.jobId!=='string'||!/^[a-f0-9]{40}$/.test(queued.jobId))throw new Error('Relay returned an invalid command receipt.');const end=now()+maxWaitMs;while(now()<end){let result;try{result=await request(`/v1/hud/commands/${queued.jobId}`,{token:deviceToken});}catch(error){if(error.status!==401||!await renew())throw error;result=await request(`/v1/hud/commands/${queued.jobId}`,{token:deviceToken});}if(result.status==='complete'&&typeof result.result?.content==='string')return result.result.content.slice(0,5000);await new Promise(resolve=>setTimeout(resolve,pollMs));}throw new Error('Google lookup is taking too long. Try again.');},
    });
  }
  return {APPS,commandHelp,normalizeOrigin,normalizeCompanionUrl,indexedDbSessionStore,createGoogleConnectorClient};
});
