const fs=require('fs'),XLSX=require('xlsx'),dump=require('./.tmp-ledger-scope-dump.json');
const norm=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const parseDate=x=>{const m=String(x).match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:''};
const cents=x=>Math.round((Number(String(x||0).replace(/[,?\s]/g,''))||0)*100);
const tmap={'Purchase':'PURCHASE','RCM Purchase':'RCM_PURCHASE','Receipt':'RECEIPT','Payment':'PAYMENT','CASH PAYMENT':'CASH_PAYMENT','Journal':'JOURNAL','Journal Expenses':'JOURNAL','Inward Debit Note':'DEBIT_NOTE','Inward Credit Note':'CREDIT_NOTE','RCM Debit Note':'DEBIT_NOTE','Salary Payment':'PAYMENT','Tax Invoice':'SALE'};
const result=[];
for(const [wb,path] of [['Sundry Creditors','C:/Users/razon/Downloads/Sundry_Creditors_Vouchers.xlsx'],['Advance From S. Debtors','C:/Users/razon/Downloads/Advance_From_S_Debtors.xlsx']]){
 const root=dump.roots.find(r=>norm(r.name)===norm(wb));
 const entries=root.entries, byId=new Map();for(const e of entries){if(!byId.has(e.ledgerId))byId.set(e.ledgerId,[]);byId.get(e.ledgerId).push(e);}
 const ledgers=root.ledgers, byName=new Map();for(const l of ledgers){let k=norm(l.name);if(!byName.has(k))byName.set(k,[]);byName.get(k).push(l);}
 const rows=XLSX.utils.sheet_to_json(XLSX.readFile(path).Sheets['Voucher Details'],{header:1,defval:null,raw:false}).slice(4).filter(r=>r[1]);
 const stats={total:rows.length,targetExact:0,targetIgnoringType:0,noMatchName:0,wrongLedger:0,noVoucher:0,wrongFields:0,duplicateTarget:0,ambiguousAccounts:0};const results=[];
 for(const r of rows){const [date,name,type,no,part]=r;const dt=parseDate(date),side=cents(r[5])?'DEBIT':'CREDIT',amount=Math.max(cents(r[5]),cents(r[6])),noN=norm(no),n=norm(name),expectedType=tmap[type];const candidates=byName.get(n)||[];const es=candidates.flatMap(l=>byId.get(l.id)||[]);const find=(e,checkType)=>{const nmatch=[e.no,...e.journals.map(j=>j.no)].some(x=>norm(x)===noN);return nmatch&&e.date===dt&&e.entryType===side&&e.cents===amount&&(!checkType||e.type===expectedType)};const exact=es.filter(e=>find(e,true)),noType=es.filter(e=>find(e,false));let status='';if(exact.length){status='matched';stats.targetExact++;if(exact.length>1)stats.duplicateTarget++;}else if(noType.length){status='type-mismatch';stats.targetIgnoringType++;}else if(!candidates.length){status='no-ledger';stats.noMatchName++;}else{const hasNo=es.some(e=>[e.no,...e.journals.map(j=>j.no)].some(x=>norm(x)===noN));if(hasNo){status='wrong-fields';stats.wrongFields++;}else{status='not-in-ledger';stats.noVoucher++;}}if(candidates.length>1)stats.ambiguousAccounts++;
 results.push({date:dt,agency:name,type,voucherType:expectedType,no:String(no),particulars:part,side,amountCents:amount,status,ledgers:candidates.map(l=>({id:l.id,name:l.name,group:l.group})),matches:(exact.length?exact:noType).map(e=>({id:e.voucherId,ledgerId:e.ledgerId,ledger:candidates.find(l=>l.id===e.ledgerId)?.name,type:e.type,no:e.no,date:e.date,side:e.entryType,cents:e.cents}))});}
 const perAccount={};for(const r of results){const a=perAccount[r.agency]??={rows:0,dr:0,cr:0,matched:0,unmatched:0,statuses:{}};a.rows++;if(r.side==='DEBIT')a.dr+=r.amountCents;else a.cr+=r.amountCents;if(r.status==='matched')a.matched++;else a.unmatched++;a.statuses[r.status]=(a.statuses[r.status]||0)+1;}
 const unmatched=results.filter(r=>r.status!=='matched');const top=Object.keys(perAccount).map(k=>({agency:k,...perAccount[k]})).filter(x=>x.unmatched).sort((a,b)=>b.unmatched-a.unmatched);
 const val={wb,stats,unmatched:unmatched.length,topUnmatched:top,unmatchedRows:unmatched,allRows:results};result.push(val);
 console.log('\n'+wb,JSON.stringify({stats,unmatched:unmatched.length,topUnmatched:top.slice(0,30),sample:unmatched.slice(0,15)},null,2));
}
fs.writeFileSync('.tmp-ledger-workbook-match.json',JSON.stringify(result));
