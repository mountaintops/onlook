import { createClient } from "@supabase/supabase-js";
import { FREE_SEED_USER, SEED_USER } from "./constants";

const createUserIfNotExists = async (supabase: any, user: typeof SEED_USER | typeof FREE_SEED_USER) => {
    const { data: { user: existingUser } } = await supabase.auth.admin.getUserById(user.ID);

    if (existingUser) {
        console.log(`User ${user.EMAIL} already exists, skipping user creation`);
        return;
    }

    try {
        const { error } = await supabase.auth.admin.createUser({
            id: user.ID,
            email: user.EMAIL,
            password: user.PASSWORD,
            email_confirm: true,
            user_metadata: {
                first_name: user.FIRST_NAME,
                last_name: user.LAST_NAME,
                display_name: user.DISPLAY_NAME,
                avatar_url: user.AVATAR_URL,
            },
        });

        if (error) {
            console.error(`Error seeding Supabase user ${user.EMAIL}:`, error);
            throw error;
        }
        console.log(`User ${user.EMAIL} seeded!`);
    } catch (error: any) {
        if (error.message?.includes('duplicate key value')) {
            console.log(`User ${user.EMAIL} already exists with this email, skipping user creation`);
            return;
        }
        console.error(`Error seeding Supabase user ${user.EMAIL}:`, error);
        throw error;
    }
};

export const seedSupabaseUser = async () => {
    console.log('Seeding Supabase users...');

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    await createUserIfNotExists(supabase, SEED_USER);
    await createUserIfNotExists(supabase, FREE_SEED_USER);
};
