const XLSX=require('xlsx');
function money(v){if(v==null||v==='')return 0; if(typeof v==='number')return v; return Number(String(v).replace(/[,?\s]/g,''))||0}
for(const [name,path] of [['creditors','C:/Users/razon/Downloads/Sundry_Creditors_Vouchers.xlsx'],['advances','C:/Users/razon/Downloads/Advance_From_S_Debtors.xlsx']]){
 const rows=XLSX.utils.sheet_to_json(XLSX.readFile(path,{cellDates:true}).Sheets['Voucher Details'],{header:1,defval:null,raw:false}).slice(4);
 let ag=new Map(), types=new Map(), dups=new Map(), rowsWithNo=0, totals=[0,0], dates=new Map();
 for(const r of rows){if(!r[1])continue;let [date,agency,type,no,particulars]=r;let debit=money(r[5]),credit=money(r[6]);let a=ag.get(agency)||{n:0,dr:0,cr:0,types:{}};a.n++;a.dr+=debit;a.cr+=credit;a.types[type]=(a.types[type]||0)+1;ag.set(agency,a);types.set(type,(types.get(type)||0)+1);totals[0]+=debit;totals[1]+=credit;if(!no)rowsWithNo++; const k=[agency,date,type,no,particulars,debit,credit].join('|');dups.set(k,(dups.get(k)||0)+1); dates.set(date,(dates.get(date)||0)+1);}
 console.log('\n'+name,'rows',rows.length,'total',totals,'agencies',ag.size,'types',Object.fromEntries(types),'blankNo',rowsWithNo,'dupeRows',Array.from(dups.values()).filter(n=>n>1).reduce((s,n)=>s+n-1,0));
 console.log(JSON.stringify([...ag.entries()].sort((x,y)=>x[0].localeCompare(y[0])).map(([agency,v])=>({agency,...v})),null,2));
}
