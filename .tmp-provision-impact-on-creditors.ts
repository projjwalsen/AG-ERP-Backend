import "dotenv/config";
import * as fs from "fs";
import { prisma } from "./src/config/db";
const branch='47fdc8aa-83ba-46f9-93ec-4517e0eb13bb';
(async()=>{
 const backup=JSON.parse(fs.readFileSync('.tmp-provision-expenses-reconcile-backup.json','utf8'));
 const groups=await prisma.ledgerGroup.findMany();const root=groups.find(g=>g.name==='Sundry Creditors'&&g.parentId)!;
 const gids=new Set([root.id]);let change=true;while(change){change=false;for(const g of groups)if(g.parentId&&gids.has(g.parentId)&&!gids.has(g.id)){gids.add(g.id);change=true}}
 const sc=await prisma.ledger.findMany({where:{branchId:branch,groupId:{in:[...gids]}},select:{id:true,name:true}});const scMap=new Map(sc.map(l=>[l.id,l.name]));
 const deleted=backup.deletedVouchers;const impacted=deleted.flatMap((v:any)=>v.entries.filter((e:any)=>scMap.has(e.ledgerId)).map((e:any)=>({voucher:v.voucherNo,type:v.voucherType,ledger:scMap.get(e.ledgerId),side:e.entryType,amount:String(e.amount)})));
 const headIds=[...new Set(deleted.flatMap((v:any)=>v.journals.map((j:any)=>j.journalHeadId)))];const heads=await prisma.journalHead.findMany({where:{id:{in:headIds}},include:{ledger:true}});const hm=new Map(heads.map(h=>[h.id,h]));
 const journalImpact=deleted.flatMap((v:any)=>v.journals.filter((j:any)=>scMap.has(hm.get(j.journalHeadId)?.ledgerId||'')).map((j:any)=>({voucher:v.voucherNo,source:j.sourceSheet,serialNo:j.serialNo,amount:String(j.amount),ledger:hm.get(j.journalHeadId)?.ledger.name})));
 const deletedLedgerIds=[...new Set(deleted.flatMap((v:any)=>v.entries.map((e:any)=>e.ledgerId)))];const deletedLedgers=await prisma.ledger.findMany({where:{id:{in:deletedLedgerIds}},select:{id:true,name:true,groupId:true}});const groupCounts:any={};for(const v of deleted)for(const e of v.entries){const l=deletedLedgers.find(x=>x.id===e.ledgerId);const g=groups.find(x=>x.id===l?.groupId);groupCounts[g?.name||'unknown']=(groupCounts[g?.name||'unknown']||0)+1;}
 console.log(JSON.stringify({deletedVoucherCount:deleted.length,deletedEntryCount:deleted.reduce((s:number,v:any)=>s+v.entries.length,0),deletedVoucherEntriesInSundryCreditors:impacted,deletedJournalRowsInSundryCreditors:journalImpact,entryCountsByGroup:groupCounts},null,2));await prisma.$disconnect();
})().catch(async e=>{console.error(e);await prisma.$disconnect();process.exitCode=1});
