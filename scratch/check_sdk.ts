import { Daytona } from '@daytonaio/sdk';

const client = new Daytona({ apiKey: 'dummy' });
console.log('client.snapshot.list.length:', client.snapshot.list.length);
console.log('client.list.length:', client.list.length);
