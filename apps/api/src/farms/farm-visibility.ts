import {
  PartnerVerificationStatus,
  RecordStatus,
} from '../../generated/prisma/enums.js';

/** Public Farm reads require an active farm owned by an active, verified partner. */
export const publicPartnerVisibility = {
  is: {
    status: RecordStatus.ACTIVE,
    verificationStatus: PartnerVerificationStatus.VERIFIED,
  },
};

export const publicFarmVisibility = {
  is: {
    status: RecordStatus.ACTIVE,
    partner: publicPartnerVisibility,
  },
};
