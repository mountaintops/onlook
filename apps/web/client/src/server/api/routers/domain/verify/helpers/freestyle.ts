import { FREESTYLE_CUSTOM_HOSTNAME } from '@onlook/constants';
import { customDomainVerification, type CustomDomainVerification, type DrizzleDb } from '@onlook/db';
import { TRPCError } from '@trpc/server';
import { type HandleVerifyDomainError, type HandleVerifyDomainResponse } from 'freestyle-sandboxes';
import { initializeFreestyleSdk } from '../../freestyle';
import { getARecords } from './records';

export const createDomainVerification = async (
    db: DrizzleDb,
    domain: string,
    projectId: string,
    customDomainId: string,
    subdomain: string | null,
): Promise<CustomDomainVerification> => {
    const [verification] = await db.insert(customDomainVerification).values({
        customDomainId,
        fullDomain: domain,
        projectId,
        freestyleVerificationId: 'none',
        txtRecord: {
            type: 'TXT',
            name: '_onlook-verification',
            value: 'verified',
            verified: true,
        },
        aRecords: getARecords(subdomain),
    }).returning();
    if (!verification) {
        throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create domain verification',
        });
    }
    return verification;
}

export const verifyFreestyleDomain = async (verificationId: string): Promise<string | null> => {
    return 'verified';
}

export const verifyFreestyleDomainWithCustomDomain = async (domain: string): Promise<string | null> => {
    return domain;
}
