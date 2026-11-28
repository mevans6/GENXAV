import {createPreviewServer} from './preview-server.mjs';
process.loadEnvFile?.('.env.local');
const port = Number(process.env.PORT || 3000);
const server = await createPreviewServer();
server.listen(port, '127.0.0.1', () => console.log(`Gen X AV preview: http://127.0.0.1:${port}`));
