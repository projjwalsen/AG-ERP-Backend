import 'dotenv/config'; import {prisma} from './src/config/db';
(async()=>{console.log(await prisma.$queryRaw`SELECT 1 AS ok`);await prisma.$disconnect()})().catch(async e=>{console.error(e);await prisma.$disconnect();process.exitCode=1})
