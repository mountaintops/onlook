'use client';

export const PricingTable = () => {
    return (
        <div className="flex flex-col items-center gap-6 sm:gap-8 w-full max-w-6xl mx-auto py-12">
            <div className="text-center space-y-4">
                <h2 className="text-3xl font-bold text-foreground">Everything is Free</h2>
                <p className="text-xl text-foreground-secondary max-w-2xl mx-auto">
                    We've removed all limits. Enjoy full access to all features, including AI-powered editing, 
                    custom domains, and code downloads, completely free of charge.
                </p>
            </div>
        </div>
    );
};
