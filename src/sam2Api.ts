export class Sam2RequestError extends Error {
  status:number
  code:string
  constructor(message:string, status:number, code='') { super(message);this.name='Sam2RequestError';this.status=status;this.code=code }
}

function detail(value:unknown, depth=0):{message?:string;code?:string} {
  if(typeof value==='string')return {message:value}
  if(!value || typeof value!=='object' || depth>3)return {}
  const object=value as Record<string,unknown>
  const nested=detail(object.error??object.detail,depth+1)
  return {message:typeof object.message==='string'?object.message:nested.message,
    code:typeof object.code==='string'?object.code:nested.code}
}

/** Decode proxy/platform failures as well as the Python service's string errors. */
export async function sam2Request<T>(url:string, body?:unknown, fetcher:typeof fetch=fetch):Promise<T> {
  let response:Response,raw:string
  try {
    response=await fetcher(url,{
      ...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),
      signal:AbortSignal.timeout(url.endsWith('/predict')?120000:20000),
    })
    raw=await response.text()
  }catch(error){
    const timeout=error instanceof Error && ['TimeoutError','AbortError'].includes(error.name)
    throw new Sam2RequestError(timeout?'SAM2 took too long to respond. Your points and draft are preserved; check the connection and retry.':'Could not reach SAM2. Your points and draft are preserved; check the connection and retry.',0,timeout?'TIMEOUT':'NETWORK_ERROR')
  }
  let result:unknown
  try{result=JSON.parse(raw)}catch{result=undefined}
  if(!response.ok){
    const info=detail(result),code=(response.headers.get('x-vercel-error')||info.code||'').toUpperCase()
    const stopped=response.status===410 || ['SANDBOX_STOPPED','SANDBOX_NOT_RUNNING','SANDBOX_EXPIRED'].includes(code)
    if(stopped)throw new Sam2RequestError('The temporary SAM2 server has stopped. Your points and draft are preserved. Restart the session, then check the connection and retry Generate mask.',response.status,code||'SANDBOX_STOPPED')
    const message=info.message?.trim()||`SAM2 request failed (HTTP ${response.status}${code?`, ${code}`:''}).`
    throw new Sam2RequestError(`${message} Your points and draft are preserved.`,response.status,code)
  }
  if(!result || typeof result!=='object')throw new Sam2RequestError('SAM2 returned an invalid response. Your points and draft are preserved; check the connection and retry.',response.status,'INVALID_RESPONSE')
  return result as T
}
