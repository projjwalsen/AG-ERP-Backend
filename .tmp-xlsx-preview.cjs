const XLSX=require('xlsx');
for(const f of ['C:/Users/razon/Downloads/Sundry_Creditors_Vouchers.xlsx','C:/Users/razon/Downloads/Advance_From_S_Debtors.xlsx']){
 const w=XLSX.readFile(f,{cellDates:true});
 console.log('\nFILE',f);
 for(const s of w.SheetNames){const sh=w.Sheets[s];const rows=XLSX.utils.sheet_to_json(sh,{header:1,defval:null,raw:false});console.log('SHEET',s,'range',sh['!ref'],'rows',rows.length); console.log(JSON.stringify(rows.slice(0,12)));}
}
