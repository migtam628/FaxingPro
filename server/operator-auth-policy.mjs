// Deliberate, opt-in compatibility policy for the legacy administrator bearer.
// Do not weaken the browser session/TOTP login or integration-token scopes.
export function parseMasterBearerMode(value,totpConfigured){
  const mode=value===undefined||value===''?'legacy':value;
  if(mode!=='legacy'&&mode!=='disabled')
    throw Error('Invalid OPERATOR_BEARER_MODE: expected legacy or disabled');
  if(mode==='disabled'&&!totpConfigured)
    throw Error('OPERATOR_BEARER_MODE=disabled requires OPERATOR_TOTP_SECRET (prevent operator lockout)');
  return mode;
}
export function masterBearerAllowed(mode){
  return mode==='legacy';
}
