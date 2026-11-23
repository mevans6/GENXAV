import {defineConfig} from 'vitest/config';
import path from 'node:path';
export default defineConfig({resolve:{alias:{'@lib':path.resolve('server/lib'),'@cookies':path.resolve('server/cookies.ts'),'next/link':path.resolve('client/compat.tsx')}},test:{include:['tests/**/*.test.ts']}});
