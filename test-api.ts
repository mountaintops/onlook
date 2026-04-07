import { appRouter, createCaller } from "./apps/web/client/src/server/api/root";

async function main() {
    const caller = createCaller({});
    console.log(Object.keys(caller));
}
main();
