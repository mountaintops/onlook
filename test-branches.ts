import { db } from "./packages/db/src/index";
import { branches } from "./packages/db/src/schema/project/branch";
import { eq } from "drizzle-orm";

async function main() {
    const allBranches = await db.select().from(branches);
    console.log("All branches count:", allBranches.length);
    if(allBranches.length > 0) {
        console.log("Default status:", allBranches.map(b => b.isDefault));
        console.log("Sandbox IDs:", allBranches.map(b => b.sandboxId));
    }
}
main().catch(console.error);
