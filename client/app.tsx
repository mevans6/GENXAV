import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import IntakeForm from './intake-form';
import {ConsultingAdmin} from './consulting-admin';
import {ConsultationInvitation} from './consultation-invitation';
import {CheckoutComplete} from './checkout-complete';
import Ticket from './ticket';
function Admin() {
 const [token,setToken]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[leads,setLeads]=useState<any[]>([]);
 async function login(event:any) {
  event.preventDefault();setBusy(true);setError('');const data=new FormData(event.currentTarget);
  try {
   const config=await fetch('/api/consulting/public-config').then(r=>r.json());
   if(!config.url||!config.key) throw Error('Administrator sign-in is not configured.');
   const response=await fetch(`${config.url}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:config.key,'Content-Type':'application/json'},body:JSON.stringify({email:data.get('email'),password:data.get('password')})});
   const session=await response.json();if(!response.ok) throw Error('Sign-in failed.');
   const check=await fetch('/api/consulting/integrator-leads',{headers:{Authorization:`Bearer ${session.access_token}`}});
   const result=await check.json();if(!check.ok) throw Error(result.error);setLeads(result.leads);setToken(session.access_token);
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 if(!token)return <form className="form-panel" onSubmit={login}><h2>Private lead dashboard</h2><label>Email<input name="email" type="email" autoComplete="username" required/></label><label>Password<input name="password" type="password" autoComplete="current-password" required/></label>{error&&<p role="alert">{error}</p>}<button className="button" disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form>;
 return <><button className="button" onClick={()=>{setToken('');setLeads([])}}>Sign out</button><ConsultingAdmin token={token}/><section><h2>Integrator leads</h2>{leads.length===0?<p>No integrator leads.</p>:leads.map(lead=><article className="form-panel" key={lead.id}><h3>{lead.name}</h3><p>{lead.email}</p><pre>{lead.message}</pre></article>)}</section></>;
}
const path=location.pathname;
let component;
if(path==='/consulting/admin') component=<Admin/>;
else if(path.startsWith('/consulting/invitation/')) component=<ConsultationInvitation id={path.split('/').at(-1)!}/>;
else if(path.startsWith('/consulting/ticket/')) component=<Ticket/>;
else if(path==='/consulting/complete')component=<CheckoutComplete/>;
else component=<IntakeForm/>;
createRoot(document.getElementById('consulting-app')!).render(component);
