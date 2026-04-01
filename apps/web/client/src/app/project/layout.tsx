import { env } from "@/env";
import { Routes } from "@/utils/constants";
import { createClient } from "@/utils/supabase/server";
import { checkUserSubscriptionAccess } from "@/utils/subscription";
import { redirect } from "next/navigation";

export default async function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
    const supabase = await createClient();
    const {
        data: { session },
    } = await supabase.auth.getSession();

    return <>{children}</>;
}