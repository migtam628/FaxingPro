import type { Fax } from './types';
export const demoFaxes: Fax[] = [
  { id:'FX-1048',title:'Service Agreement.pdf',contact:'Westfield Medical',number:'+1 (555) 321-0876',pages:6,status:'received',direction:'inbound',createdAt:'Today, 11:02 AM',unread:true,source:'demo'},
  { id:'FX-1047',title:'Client Contract.pdf',contact:'Acme Corporation',number:'+1 (555) 624-1329',pages:3,status:'sent',direction:'outbound',createdAt:'Today, 10:41 AM',source:'demo'},
  { id:'FX-1046',title:'Insurance Forms.pdf',contact:'City Insurance',number:'+1 (555) 867-6543',pages:5,status:'received',direction:'inbound',createdAt:'Today, 9:18 AM',unread:true,source:'demo'},
  { id:'FX-1045',title:'Purchase Order.pdf',contact:'Johnson Law Firm',number:'+1 (555) 114-4567',pages:4,status:'queued',direction:'outbound',createdAt:'Yesterday, 4:22 PM',source:'demo'},
  { id:'FX-1044',title:'Office Documents.pdf',contact:'Metro Health',number:'+1 (555) 222-9876',pages:2,status:'sent',direction:'outbound',createdAt:'Yesterday, 2:10 PM',source:'demo'},
  { id:'FX-1043',title:'Referral.pdf',contact:'Northshore Clinic',number:'+1 (555) 009-2100',pages:1,status:'failed',direction:'outbound',createdAt:'Oct 23, 12:30 PM',source:'demo'},
  { id:'FX-1042',title:'Vendor Application.pdf',contact:'Ellison Partners',number:'+1 (555) 783-1920',pages:7,status:'received',direction:'inbound',createdAt:'Oct 22, 3:14 PM',source:'demo'}
];
export const contacts = [
 {name:'Westfield Medical',company:'Westfield Medical',number:'+1 (555) 321-0876',initials:'WM'},
 {name:'Acme Corporation',company:'Acme Corporation',number:'+1 (555) 624-1329',initials:'AC'},
 {name:'City Insurance',company:'City Insurance',number:'+1 (555) 867-6543',initials:'CI'},
 {name:'Johnson Law Firm',company:'Johnson Law Firm',number:'+1 (555) 114-4567',initials:'JL'},
 {name:'Metro Health',company:'Metro Health',number:'+1 (555) 222-9876',initials:'MH'}
];
