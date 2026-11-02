-- CreateEnum
CREATE TYPE "FranchiseApplicationStatus" AS ENUM ('APPLICATION_SUBMITTED', 'UNDER_REVIEW', 'INTERVIEW_DISCUSSION', 'APPROVED', 'PAYMENT_PENDING', 'AGREEMENT_PENDING', 'ACTIVE_FRANCHISE', 'REJECTED');

-- CreateEnum
CREATE TYPE "FranchiseDocumentKind" AS ENUM ('ID_PROOF', 'PHOTO', 'ADDRESS_PROOF', 'BUSINESS_PLAN', 'ADDITIONAL');

-- CreateEnum
CREATE TYPE "FranchiseDocRequestStatus" AS ENUM ('OPEN', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FranchiseInterviewMode" AS ENUM ('IN_PERSON', 'PHONE', 'VIDEO');

-- CreateEnum
CREATE TYPE "FranchiseInterviewStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FranchisePaymentStatus" AS ENUM ('CREATED', 'PAID', 'FAILED', 'SUPERSEDED', 'DUPLICATE_PAID');

-- CreateEnum
CREATE TYPE "FranchiseTemplateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "FranchisePartnerStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FranchisePartnerEventType" AS ENUM ('ACTIVATED', 'SUSPENDED', 'REINSTATED', 'DEACTIVATED', 'EXPIRED', 'RENEWED', 'ATTRIBUTION_PAUSED', 'ATTRIBUTION_RESUMED', 'PAYOUTS_PAUSED', 'PAYOUTS_RESUMED');

-- CreateEnum
CREATE TYPE "DistrictAllocationRole" AS ENUM ('PRIMARY');

-- CreateEnum
CREATE TYPE "DistrictAllocationStatus" AS ENUM ('RESERVED', 'ALLOCATED', 'SUSPENDED', 'RELEASED');

-- CreateEnum
CREATE TYPE "PolicyDomain" AS ENUM ('COMMERCIAL', 'REVENUE_SHARE', 'SETTLEMENT', 'TAX', 'GST_INVOICE', 'NOTIFICATION');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'PUBLISHED', 'SUPERSEDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AdminApprovalAction" AS ENUM ('POLICY_PUBLISH', 'DISTRICT_REASSIGN', 'DISTRICT_RELEASE', 'BENEFICIARY_CHANGE', 'PARTNER_REINSTATE', 'PARTNER_DEACTIVATE', 'SETTLEMENT_BATCH_APPROVE', 'PAYOUT_PROVIDER_ACTIVATE', 'RESERVE_RELEASE_MANUAL', 'DEBT_WRITE_OFF', 'LEDGER_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "AdminApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'EXECUTED');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('PARTNER_HELD', 'PARTNER_PAYABLE', 'PARTNER_RESERVE', 'PARTNER_DEBT', 'ETA_REVENUE', 'GST_PAYABLE', 'GATEWAY_FEES', 'GATEWAY_FEE_RECOVERY', 'TDS_PAYABLE', 'REFUND_CHARGEBACK_ADJUSTMENTS', 'RAZORPAY_CLEARING', 'SALES_CLEARING', 'PAYOUT_IN_TRANSIT', 'PAYOUT_FEES', 'BANK');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerJournalType" AS ENUM ('ORDER_CAPTURE', 'REVENUE_SHARE', 'EARNINGS_MATURITY', 'RESERVE_RELEASE', 'TDS_DEDUCTION', 'REFUND', 'CHARGEBACK', 'CHARGEBACK_REVERSAL', 'PAYOUT_INITIATED', 'PAYOUT_PAID', 'PAYOUT_FAILED', 'PAYOUT_FEE', 'DEBT_RECOVERY', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "EarningsLotStatus" AS ENUM ('HELD', 'MATURED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ReserveLotStatus" AS ENUM ('HELD', 'RELEASED', 'CONSUMED');

-- CreateEnum
CREATE TYPE "FranchiseAttributionStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "OrderRefundStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentDisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'WON', 'LOST', 'CLOSED');

-- CreateEnum
CREATE TYPE "SettlementBatchStatus" AS ENUM ('SCHEDULED', 'CALCULATING', 'LOCKED', 'AWAITING_APPROVAL', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_FAILURES', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SettlementLineStatus" AS ENUM ('PENDING', 'READY', 'SKIPPED', 'PAYOUT_INITIATED', 'PAID', 'FAILED', 'REVERSED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SettlementSkipReason" AS ENUM ('BELOW_MINIMUM', 'SUSPENDED', 'PAYOUTS_PAUSED', 'NO_VERIFIED_BENEFICIARY', 'NEGATIVE_BALANCE', 'PROVIDER_DISABLED', 'POLICY_PENDING');

-- CreateEnum
CREATE TYPE "PayoutChannel" AS ENUM ('BANK', 'UPI');

-- CreateEnum
CREATE TYPE "FranchisePayoutStatus" AS ENUM ('CREATED', 'INITIATED', 'PROCESSING', 'PAID', 'FAILED', 'REVERSED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "BeneficiaryStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'FAILED', 'DISABLED');

-- CreateEnum
CREATE TYPE "GstDocumentKind" AS ENUM ('FRANCHISE_FEE');

-- CreateEnum
CREATE TYPE "ESignStatus" AS ENUM ('CREATED', 'SENT', 'SIGNED', 'DECLINED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "RenewalStatus" AS ENUM ('PENDING_TERMS', 'OFFERED', 'ACCEPTED', 'DECLINED', 'LAPSED');

-- CreateTable
CREATE TABLE "PolicyVersion" (
    "id" TEXT NOT NULL,
    "domain" "PolicyDomain" NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadSha256" TEXT NOT NULL,
    "status" "PolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "approvalRequestId" TEXT,
    "approvedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminApprovalRequest" (
    "id" TEXT NOT NULL,
    "action" "AdminApprovalAction" NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadSha256" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AdminApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "openKey" TEXT,
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndiaState" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndiaState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "District" (
    "id" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "District_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistrictAllocation" (
    "id" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "role" "DistrictAllocationRole" NOT NULL DEFAULT 'PRIMARY',
    "status" "DistrictAllocationStatus" NOT NULL,
    "applicationId" TEXT,
    "partnerId" TEXT,
    "reservedAt" TIMESTAMP(3),
    "reservedUntil" TIMESTAMP(3),
    "allocatedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,
    "createdById" TEXT NOT NULL,
    "approvalRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DistrictAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistrictAllocationEvent" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "fromStatus" "DistrictAllocationStatus",
    "toStatus" "DistrictAllocationStatus" NOT NULL,
    "actorId" TEXT,
    "approvalRequestId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistrictAllocationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FranchiseApplication" (
    "id" TEXT NOT NULL,
    "applicationNo" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "FranchiseApplicationStatus" NOT NULL DEFAULT 'APPLICATION_SUBMITTED',
    "applicantName" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "education" TEXT,
    "businessExperience" TEXT,
    "officeAvailable" BOOLEAN,
    "investmentCapacityInr" INTEGER,
    "businessPlanText" TEXT,
    "requiredDocumentKinds" "FranchiseDocumentKind"[],
    "refundPolicyVersion" INTEGER NOT NULL,
    "refundPolicyText" TEXT NOT NULL,
    "refundPolicySha256" TEXT NOT NULL,
    "rejectionReason" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FranchiseApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FranchiseApplicationDocument" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "kind" "FranchiseDocumentKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "documentRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FranchiseApplicationDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FranchiseDocumentRequest" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "kinds" "FranchiseDocumentKind"[],
    "status" "FranchiseDocRequestStatus" NOT NULL DEFAULT 'OPEN',
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilledAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "FranchiseDocumentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FranchiseApplicationStatusHistory" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "fromStatus" "FranchiseApplicationStatus",
    "toStatus" "FranchiseApplicationStatus" NOT NULL,
    "actorId" TEXT,
    "actorType" TEXT NOT NULL,
    "applicantNote" TEXT,
    "internalNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FranchiseApplicationStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FranchiseApplicationNote" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibleToApplicant" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FranchiseApplicationNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FranchiseInterview" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "mode" "FranchiseInterviewMode" NOT NULL,
    "locationOrLink" TEXT,
    "applicantNote" TEXT,
    "internalOutcome" TEXT,
    "status" "FranchiseInterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FranchiseInterview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FranchiseNotification" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FranchiseNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FranchisePayment" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "status" "FranchisePaymentStatus" NOT NULL DEFAULT 'CREATED',
    "baseAmountInPaise" INTEGER NOT NULL,
    "gstAmountInPaise" INTEGER NOT NULL,
    "totalAmountInPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "gstMode" TEXT NOT NULL,
    "gstRateBps" INTEGER NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "refundPolicyVersion" INTEGER NOT NULL,
    "refundPolicyText" TEXT NOT NULL,
    "refundPolicySha256" TEXT NOT NULL,
    "razorpayOrderId" TEXT NOT NULL,
    "razorpayPaymentId" TEXT,
    "paidAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FranchisePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstInvoiceSequence" (
    "series" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "GstInvoiceSequence_pkey" PRIMARY KEY ("series","financialYear")
);

-- CreateTable
CREATE TABLE "GstInvoice" (
    "id" TEXT NOT NULL,
    "kind" "GstDocumentKind" NOT NULL,
    "series" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "franchisePaymentId" TEXT,
    "policyVersionId" TEXT NOT NULL,
    "supplierGstin" TEXT NOT NULL,
    "supplierStateCode" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "recipientGstin" TEXT,
    "recipientStateCode" TEXT NOT NULL,
    "placeOfSupplyStateCode" TEXT NOT NULL,
    "sacCode" TEXT NOT NULL,
    "taxableValueInPaise" INTEGER NOT NULL,
    "cgstInPaise" INTEGER NOT NULL,
    "sgstInPaise" INTEGER NOT NULL,
    "igstInPaise" INTEGER NOT NULL,
    "totalInPaise" INTEGER NOT NULL,
    "pdfStorageKey" TEXT,
    "pdfSha256" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GstInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstCreditNote" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "creditNoteNo" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "taxableValueInPaise" INTEGER NOT NULL,
    "cgstInPaise" INTEGER NOT NULL,
    "sgstInPaise" INTEGER NOT NULL,
    "igstInPaise" INTEGER NOT NULL,
    "totalInPaise" INTEGER NOT NULL,
    "pdfStorageKey" TEXT,
    "pdfSha256" TEXT,
    "issuedById" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GstCreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FranchiseAgreementTemplate" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "FranchiseTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FranchiseAgreementTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FranchiseAgreement" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "renderedText" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "acceptedContentSha256" TEXT,
    "acceptedName" TEXT,
    "ipHash" TEXT,
    "userAgentHash" TEXT,
    "pdfStorageKey" TEXT,
    "pdfSha256" TEXT,

    CONSTRAINT "FranchiseAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ESignRequest" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerDocumentId" TEXT,
    "status" "ESignStatus" NOT NULL DEFAULT 'CREATED',
    "documentSha256" TEXT NOT NULL,
    "signedPdfKey" TEXT,
    "signedPdfSha256" TEXT,
    "providerAuditTrail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ESignRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FranchiseRenewal" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "previousAgreementId" TEXT NOT NULL,
    "newAgreementId" TEXT,
    "status" "RenewalStatus" NOT NULL DEFAULT 'PENDING_TERMS',
    "termMonths" INTEGER,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "offeredAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FranchiseRenewal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FranchisePartner" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "franchiseCode" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "status" "FranchisePartnerStatus" NOT NULL DEFAULT 'ACTIVE',
    "agreementStartsAt" TIMESTAMP(3) NOT NULL,
    "agreementEndsAt" TIMESTAMP(3) NOT NULL,
    "attributionAllowed" BOOLEAN NOT NULL DEFAULT true,
    "payoutsPaused" BOOLEAN NOT NULL DEFAULT false,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suspendedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FranchisePartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FranchisePartnerEvent" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "type" "FranchisePartnerEventType" NOT NULL,
    "fromStatus" "FranchisePartnerStatus",
    "toStatus" "FranchisePartnerStatus",
    "actorId" TEXT,
    "approvalRequestId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FranchisePartnerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FranchiseStudent" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "studentUserId" TEXT NOT NULL,
    "status" "FranchiseAttributionStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "endReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FranchiseStudent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FranchiseOrderAttribution" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "studentLinkId" TEXT,
    "policyVersionId" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FranchiseOrderAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentFeeRecord" (
    "id" TEXT NOT NULL,
    "razorpayPaymentId" TEXT NOT NULL,
    "orderId" TEXT,
    "feeInPaise" INTEGER NOT NULL,
    "feeTaxInPaise" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentFeeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderRefund" (
    "id" TEXT NOT NULL,
    "razorpayRefundId" TEXT NOT NULL,
    "razorpayPaymentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amountInPaise" INTEGER NOT NULL,
    "status" "OrderRefundStatus" NOT NULL DEFAULT 'PENDING',
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentDispute" (
    "id" TEXT NOT NULL,
    "razorpayDisputeId" TEXT NOT NULL,
    "razorpayPaymentId" TEXT NOT NULL,
    "orderId" TEXT,
    "amountInPaise" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "status" "PaymentDisputeStatus" NOT NULL DEFAULT 'OPEN',
    "reasonCode" TEXT,
    "respondBy" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentDispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "partnerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerJournal" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "type" "LedgerJournalType" NOT NULL,
    "policyVersionId" TEXT,
    "inputs" JSONB NOT NULL,
    "inputsSha256" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "description" TEXT,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerJournal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amountInPaise" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EarningsLot" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "attributionId" TEXT NOT NULL,
    "sourceJournalId" TEXT NOT NULL,
    "amountInPaise" BIGINT NOT NULL,
    "remainingInPaise" BIGINT NOT NULL,
    "status" "EarningsLotStatus" NOT NULL DEFAULT 'HELD',
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "maturesAt" TIMESTAMP(3) NOT NULL,
    "maturedJournalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EarningsLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReserveLot" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "earningsLotId" TEXT NOT NULL,
    "createdJournalId" TEXT NOT NULL,
    "amountInPaise" BIGINT NOT NULL,
    "remainingInPaise" BIGINT NOT NULL,
    "releasedInPaise" BIGINT NOT NULL DEFAULT 0,
    "status" "ReserveLotStatus" NOT NULL DEFAULT 'HELD',
    "releasableAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReserveLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerTaxProfile" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "panEncrypted" TEXT,
    "panMasked" TEXT,
    "panVerified" BOOLEAN NOT NULL DEFAULT false,
    "gstin" TEXT,
    "gstVerified" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerTaxProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TdsDeduction" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "baseInPaise" BIGINT NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "amountInPaise" BIGINT NOT NULL,
    "provisionReference" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "quarter" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TdsDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TdsCertificate" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "quarter" INTEGER NOT NULL,
    "certificateRef" TEXT NOT NULL,
    "challanRef" TEXT,
    "storageKey" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TdsCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutBeneficiary" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "channel" "PayoutChannel" NOT NULL,
    "encryptedDetails" TEXT NOT NULL,
    "maskedIdentifier" TEXT NOT NULL,
    "holderName" TEXT NOT NULL,
    "status" "BeneficiaryStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "provider" TEXT,
    "providerBeneficiaryId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "cooldownUntil" TIMESTAMP(3),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "approvalRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutBeneficiary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementSchedule" (
    "id" TEXT NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "executionMinuteOfDay" INTEGER,
    "timezone" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementBatch" (
    "id" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "status" "SettlementBatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "snapshotSha256" TEXT,
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "totalPayoutInPaise" BIGINT NOT NULL DEFAULT 0,
    "approvalRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "processingStartedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SettlementBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementLine" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "beneficiaryId" TEXT,
    "status" "SettlementLineStatus" NOT NULL DEFAULT 'PENDING',
    "skipReason" "SettlementSkipReason",
    "inputs" JSONB NOT NULL,
    "inputsSha256" TEXT NOT NULL,
    "maturedInPaise" BIGINT NOT NULL DEFAULT 0,
    "reserveInPaise" BIGINT NOT NULL DEFAULT 0,
    "tdsInPaise" BIGINT NOT NULL DEFAULT 0,
    "previousPayoutsInPaise" BIGINT NOT NULL DEFAULT 0,
    "debtInPaise" BIGINT NOT NULL DEFAULT 0,
    "payableInPaise" BIGINT NOT NULL DEFAULT 0,
    "payoutAmountInPaise" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettlementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FranchisePayout" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "beneficiaryId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "channel" "PayoutChannel" NOT NULL,
    "amountInPaise" BIGINT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "FranchisePayoutStatus" NOT NULL DEFAULT 'CREATED',
    "providerPayoutId" TEXT,
    "utr" TEXT,
    "failureReason" TEXT,
    "initJournalId" TEXT,
    "finalJournalId" TEXT,
    "initiatedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FranchisePayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FranchisePayoutEvent" (
    "id" TEXT NOT NULL,
    "payoutId" TEXT,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT,
    "eventType" TEXT,
    "providerStatus" TEXT,
    "signatureVerified" BOOLEAN NOT NULL,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "payload" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FranchisePayoutEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PolicyVersion_approvalRequestId_key" ON "PolicyVersion"("approvalRequestId");

-- CreateIndex
CREATE INDEX "PolicyVersion_domain_status_idx" ON "PolicyVersion"("domain", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyVersion_domain_version_key" ON "PolicyVersion"("domain", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AdminApprovalRequest_openKey_key" ON "AdminApprovalRequest"("openKey");

-- CreateIndex
CREATE INDEX "AdminApprovalRequest_status_action_idx" ON "AdminApprovalRequest"("status", "action");

-- CreateIndex
CREATE INDEX "AdminApprovalRequest_targetType_targetId_idx" ON "AdminApprovalRequest"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "IndiaState_name_key" ON "IndiaState"("name");

-- CreateIndex
CREATE UNIQUE INDEX "IndiaState_code_key" ON "IndiaState"("code");

-- CreateIndex
CREATE UNIQUE INDEX "District_code_key" ON "District"("code");

-- CreateIndex
CREATE UNIQUE INDEX "District_stateId_name_key" ON "District"("stateId", "name");

-- CreateIndex
CREATE INDEX "DistrictAllocation_districtId_status_idx" ON "DistrictAllocation"("districtId", "status");

-- CreateIndex
CREATE INDEX "DistrictAllocation_partnerId_idx" ON "DistrictAllocation"("partnerId");

-- CreateIndex
CREATE INDEX "DistrictAllocation_applicationId_idx" ON "DistrictAllocation"("applicationId");

-- CreateIndex
CREATE INDEX "DistrictAllocationEvent_districtId_createdAt_idx" ON "DistrictAllocationEvent"("districtId", "createdAt");

-- CreateIndex
CREATE INDEX "DistrictAllocationEvent_allocationId_createdAt_idx" ON "DistrictAllocationEvent"("allocationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FranchiseApplication_applicationNo_key" ON "FranchiseApplication"("applicationNo");

-- CreateIndex
CREATE INDEX "FranchiseApplication_userId_idx" ON "FranchiseApplication"("userId");

-- CreateIndex
CREATE INDEX "FranchiseApplication_status_submittedAt_idx" ON "FranchiseApplication"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "FranchiseApplication_stateId_districtId_status_idx" ON "FranchiseApplication"("stateId", "districtId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FranchiseApplicationDocument_storageKey_key" ON "FranchiseApplicationDocument"("storageKey");

-- CreateIndex
CREATE INDEX "FranchiseApplicationDocument_applicationId_kind_idx" ON "FranchiseApplicationDocument"("applicationId", "kind");

-- CreateIndex
CREATE INDEX "FranchiseDocumentRequest_applicationId_status_idx" ON "FranchiseDocumentRequest"("applicationId", "status");

-- CreateIndex
CREATE INDEX "FranchiseApplicationStatusHistory_applicationId_createdAt_idx" ON "FranchiseApplicationStatusHistory"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "FranchiseApplicationNote_applicationId_createdAt_idx" ON "FranchiseApplicationNote"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "FranchiseInterview_applicationId_scheduledAt_idx" ON "FranchiseInterview"("applicationId", "scheduledAt");

-- CreateIndex
CREATE INDEX "FranchiseNotification_applicationId_createdAt_idx" ON "FranchiseNotification"("applicationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FranchisePayment_razorpayOrderId_key" ON "FranchisePayment"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "FranchisePayment_razorpayPaymentId_key" ON "FranchisePayment"("razorpayPaymentId");

-- CreateIndex
CREATE INDEX "FranchisePayment_applicationId_status_idx" ON "FranchisePayment"("applicationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GstInvoice_invoiceNo_key" ON "GstInvoice"("invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "GstInvoice_franchisePaymentId_key" ON "GstInvoice"("franchisePaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "GstInvoice_pdfStorageKey_key" ON "GstInvoice"("pdfStorageKey");

-- CreateIndex
CREATE UNIQUE INDEX "GstInvoice_series_financialYear_number_key" ON "GstInvoice"("series", "financialYear", "number");

-- CreateIndex
CREATE UNIQUE INDEX "GstCreditNote_creditNoteNo_key" ON "GstCreditNote"("creditNoteNo");

-- CreateIndex
CREATE UNIQUE INDEX "GstCreditNote_pdfStorageKey_key" ON "GstCreditNote"("pdfStorageKey");

-- CreateIndex
CREATE UNIQUE INDEX "GstCreditNote_series_financialYear_number_key" ON "GstCreditNote"("series", "financialYear", "number");

-- CreateIndex
CREATE UNIQUE INDEX "FranchiseAgreementTemplate_version_key" ON "FranchiseAgreementTemplate"("version");

-- CreateIndex
CREATE UNIQUE INDEX "FranchiseAgreement_applicationId_key" ON "FranchiseAgreement"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "FranchiseAgreement_pdfStorageKey_key" ON "FranchiseAgreement"("pdfStorageKey");

-- CreateIndex
CREATE UNIQUE INDEX "ESignRequest_signedPdfKey_key" ON "ESignRequest"("signedPdfKey");

-- CreateIndex
CREATE INDEX "ESignRequest_agreementId_idx" ON "ESignRequest"("agreementId");

-- CreateIndex
CREATE UNIQUE INDEX "ESignRequest_provider_providerDocumentId_key" ON "ESignRequest"("provider", "providerDocumentId");

-- CreateIndex
CREATE INDEX "FranchiseRenewal_partnerId_status_idx" ON "FranchiseRenewal"("partnerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FranchisePartner_userId_key" ON "FranchisePartner"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FranchisePartner_applicationId_key" ON "FranchisePartner"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "FranchisePartner_franchiseCode_key" ON "FranchisePartner"("franchiseCode");

-- CreateIndex
CREATE INDEX "FranchisePartner_districtId_status_idx" ON "FranchisePartner"("districtId", "status");

-- CreateIndex
CREATE INDEX "FranchisePartner_status_idx" ON "FranchisePartner"("status");

-- CreateIndex
CREATE INDEX "FranchisePartnerEvent_partnerId_createdAt_idx" ON "FranchisePartnerEvent"("partnerId", "createdAt");

-- CreateIndex
CREATE INDEX "FranchiseStudent_partnerId_status_idx" ON "FranchiseStudent"("partnerId", "status");

-- CreateIndex
CREATE INDEX "FranchiseStudent_studentUserId_idx" ON "FranchiseStudent"("studentUserId");

-- CreateIndex
CREATE UNIQUE INDEX "FranchiseOrderAttribution_orderId_key" ON "FranchiseOrderAttribution"("orderId");

-- CreateIndex
CREATE INDEX "FranchiseOrderAttribution_partnerId_createdAt_idx" ON "FranchiseOrderAttribution"("partnerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentFeeRecord_razorpayPaymentId_key" ON "PaymentFeeRecord"("razorpayPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderRefund_razorpayRefundId_key" ON "OrderRefund"("razorpayRefundId");

-- CreateIndex
CREATE INDEX "OrderRefund_orderId_idx" ON "OrderRefund"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentDispute_razorpayDisputeId_key" ON "PaymentDispute"("razorpayDisputeId");

-- CreateIndex
CREATE INDEX "PaymentDispute_orderId_idx" ON "PaymentDispute"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_type_partnerId_key" ON "LedgerAccount"("type", "partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerJournal_idempotencyKey_key" ON "LedgerJournal"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LedgerJournal_sourceType_sourceId_idx" ON "LedgerJournal"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "LedgerJournal_type_postedAt_idx" ON "LedgerJournal"("type", "postedAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_journalId_idx" ON "LedgerEntry"("journalId");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_createdAt_idx" ON "LedgerEntry"("accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EarningsLot_sourceJournalId_key" ON "EarningsLot"("sourceJournalId");

-- CreateIndex
CREATE UNIQUE INDEX "EarningsLot_maturedJournalId_key" ON "EarningsLot"("maturedJournalId");

-- CreateIndex
CREATE INDEX "EarningsLot_partnerId_status_maturesAt_idx" ON "EarningsLot"("partnerId", "status", "maturesAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReserveLot_earningsLotId_key" ON "ReserveLot"("earningsLotId");

-- CreateIndex
CREATE UNIQUE INDEX "ReserveLot_createdJournalId_key" ON "ReserveLot"("createdJournalId");

-- CreateIndex
CREATE INDEX "ReserveLot_partnerId_status_idx" ON "ReserveLot"("partnerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerTaxProfile_partnerId_key" ON "PartnerTaxProfile"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "TdsDeduction_journalId_key" ON "TdsDeduction"("journalId");

-- CreateIndex
CREATE INDEX "TdsDeduction_partnerId_financialYear_quarter_idx" ON "TdsDeduction"("partnerId", "financialYear", "quarter");

-- CreateIndex
CREATE UNIQUE INDEX "TdsCertificate_storageKey_key" ON "TdsCertificate"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "TdsCertificate_partnerId_financialYear_quarter_key" ON "TdsCertificate"("partnerId", "financialYear", "quarter");

-- CreateIndex
CREATE INDEX "PayoutBeneficiary_partnerId_status_idx" ON "PayoutBeneficiary"("partnerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutBeneficiary_provider_providerBeneficiaryId_key" ON "PayoutBeneficiary"("provider", "providerBeneficiaryId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementSchedule_policyVersionId_key" ON "SettlementSchedule"("policyVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementBatch_periodKey_key" ON "SettlementBatch"("periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementBatch_approvalRequestId_key" ON "SettlementBatch"("approvalRequestId");

-- CreateIndex
CREATE INDEX "SettlementLine_partnerId_status_idx" ON "SettlementLine"("partnerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementLine_batchId_partnerId_key" ON "SettlementLine"("batchId", "partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "FranchisePayout_lineId_key" ON "FranchisePayout"("lineId");

-- CreateIndex
CREATE UNIQUE INDEX "FranchisePayout_idempotencyKey_key" ON "FranchisePayout"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "FranchisePayout_initJournalId_key" ON "FranchisePayout"("initJournalId");

-- CreateIndex
CREATE UNIQUE INDEX "FranchisePayout_finalJournalId_key" ON "FranchisePayout"("finalJournalId");

-- CreateIndex
CREATE INDEX "FranchisePayout_status_initiatedAt_idx" ON "FranchisePayout"("status", "initiatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FranchisePayout_provider_providerPayoutId_key" ON "FranchisePayout"("provider", "providerPayoutId");

-- CreateIndex
CREATE INDEX "FranchisePayoutEvent_payoutId_receivedAt_idx" ON "FranchisePayoutEvent"("payoutId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FranchisePayoutEvent_provider_providerEventId_key" ON "FranchisePayoutEvent"("provider", "providerEventId");

-- AddForeignKey
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "AdminApprovalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminApprovalRequest" ADD CONSTRAINT "AdminApprovalRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminApprovalRequest" ADD CONSTRAINT "AdminApprovalRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "District" ADD CONSTRAINT "District_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "IndiaState"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistrictAllocation" ADD CONSTRAINT "DistrictAllocation_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistrictAllocation" ADD CONSTRAINT "DistrictAllocation_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "FranchiseApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistrictAllocation" ADD CONSTRAINT "DistrictAllocation_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "FranchisePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistrictAllocationEvent" ADD CONSTRAINT "DistrictAllocationEvent_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "DistrictAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistrictAllocationEvent" ADD CONSTRAINT "DistrictAllocationEvent_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseApplication" ADD CONSTRAINT "FranchiseApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseApplication" ADD CONSTRAINT "FranchiseApplication_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "IndiaState"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseApplication" ADD CONSTRAINT "FranchiseApplication_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseApplicationDocument" ADD CONSTRAINT "FranchiseApplicationDocument_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "FranchiseApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseApplicationDocument" ADD CONSTRAINT "FranchiseApplicationDocument_documentRequestId_fkey" FOREIGN KEY ("documentRequestId") REFERENCES "FranchiseDocumentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseDocumentRequest" ADD CONSTRAINT "FranchiseDocumentRequest_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "FranchiseApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseApplicationStatusHistory" ADD CONSTRAINT "FranchiseApplicationStatusHistory_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "FranchiseApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseApplicationNote" ADD CONSTRAINT "FranchiseApplicationNote_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "FranchiseApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseInterview" ADD CONSTRAINT "FranchiseInterview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "FranchiseApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseNotification" ADD CONSTRAINT "FranchiseNotification_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "FranchiseApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchisePayment" ADD CONSTRAINT "FranchisePayment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "FranchiseApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchisePayment" ADD CONSTRAINT "FranchisePayment_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstInvoice" ADD CONSTRAINT "GstInvoice_franchisePaymentId_fkey" FOREIGN KEY ("franchisePaymentId") REFERENCES "FranchisePayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstInvoice" ADD CONSTRAINT "GstInvoice_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstCreditNote" ADD CONSTRAINT "GstCreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "GstInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseAgreement" ADD CONSTRAINT "FranchiseAgreement_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "FranchiseApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseAgreement" ADD CONSTRAINT "FranchiseAgreement_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "FranchiseAgreementTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseAgreement" ADD CONSTRAINT "FranchiseAgreement_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ESignRequest" ADD CONSTRAINT "ESignRequest_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "FranchiseAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseRenewal" ADD CONSTRAINT "FranchiseRenewal_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "FranchisePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseRenewal" ADD CONSTRAINT "FranchiseRenewal_previousAgreementId_fkey" FOREIGN KEY ("previousAgreementId") REFERENCES "FranchiseAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseRenewal" ADD CONSTRAINT "FranchiseRenewal_newAgreementId_fkey" FOREIGN KEY ("newAgreementId") REFERENCES "FranchiseAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchisePartner" ADD CONSTRAINT "FranchisePartner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchisePartner" ADD CONSTRAINT "FranchisePartner_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "FranchiseApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchisePartner" ADD CONSTRAINT "FranchisePartner_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchisePartnerEvent" ADD CONSTRAINT "FranchisePartnerEvent_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "FranchisePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseStudent" ADD CONSTRAINT "FranchiseStudent_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "FranchisePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseStudent" ADD CONSTRAINT "FranchiseStudent_studentUserId_fkey" FOREIGN KEY ("studentUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseOrderAttribution" ADD CONSTRAINT "FranchiseOrderAttribution_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseOrderAttribution" ADD CONSTRAINT "FranchiseOrderAttribution_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "FranchisePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseOrderAttribution" ADD CONSTRAINT "FranchiseOrderAttribution_studentLinkId_fkey" FOREIGN KEY ("studentLinkId") REFERENCES "FranchiseStudent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentFeeRecord" ADD CONSTRAINT "PaymentFeeRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRefund" ADD CONSTRAINT "OrderRefund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentDispute" ADD CONSTRAINT "PaymentDispute_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "FranchisePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerJournal" ADD CONSTRAINT "LedgerJournal_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "LedgerJournal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarningsLot" ADD CONSTRAINT "EarningsLot_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "FranchisePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarningsLot" ADD CONSTRAINT "EarningsLot_attributionId_fkey" FOREIGN KEY ("attributionId") REFERENCES "FranchiseOrderAttribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReserveLot" ADD CONSTRAINT "ReserveLot_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "FranchisePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReserveLot" ADD CONSTRAINT "ReserveLot_earningsLotId_fkey" FOREIGN KEY ("earningsLotId") REFERENCES "EarningsLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerTaxProfile" ADD CONSTRAINT "PartnerTaxProfile_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "FranchisePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TdsDeduction" ADD CONSTRAINT "TdsDeduction_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "FranchisePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TdsDeduction" ADD CONSTRAINT "TdsDeduction_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TdsCertificate" ADD CONSTRAINT "TdsCertificate_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "FranchisePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutBeneficiary" ADD CONSTRAINT "PayoutBeneficiary_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "FranchisePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementSchedule" ADD CONSTRAINT "SettlementSchedule_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementBatch" ADD CONSTRAINT "SettlementBatch_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "SettlementSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementBatch" ADD CONSTRAINT "SettlementBatch_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementLine" ADD CONSTRAINT "SettlementLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SettlementBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementLine" ADD CONSTRAINT "SettlementLine_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "FranchisePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementLine" ADD CONSTRAINT "SettlementLine_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "PayoutBeneficiary"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchisePayout" ADD CONSTRAINT "FranchisePayout_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "SettlementLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchisePayout" ADD CONSTRAINT "FranchisePayout_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "FranchisePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchisePayout" ADD CONSTRAINT "FranchisePayout_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "PayoutBeneficiary"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchisePayoutEvent" ADD CONSTRAINT "FranchisePayoutEvent_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "FranchisePayout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================================
-- Franchise foundation guards (not expressible in the Prisma schema). Additive only.
-- =====================================================================================

-- ---------- Partial unique indexes ----------
-- One open (non-rejected) application per account; a rejected applicant may apply again.
CREATE UNIQUE INDEX "FranchiseApplication_one_open_per_user" ON "FranchiseApplication"("userId") WHERE "status" <> 'REJECTED';
-- At most one effective (PAID) fee payment per application; later captures are DUPLICATE_PAID.
CREATE UNIQUE INDEX "FranchisePayment_one_paid_per_application" ON "FranchisePayment"("applicationId") WHERE "status" = 'PAID';
-- Exactly one PRIMARY franchise holds a district (reserved, allocated or suspended) at a time.
CREATE UNIQUE INDEX "DistrictAllocation_one_primary_per_district" ON "DistrictAllocation"("districtId") WHERE "role" = 'PRIMARY' AND "status" IN ('RESERVED', 'ALLOCATED', 'SUSPENDED');
-- One PUBLISHED policy per domain.
CREATE UNIQUE INDEX "PolicyVersion_one_published_per_domain" ON "PolicyVersion"("domain") WHERE "status" = 'PUBLISHED';
-- One company-wide ledger account per type (the (type, partnerId) unique key treats NULLs as distinct).
CREATE UNIQUE INDEX "LedgerAccount_one_company_account_per_type" ON "LedgerAccount"("type") WHERE "partnerId" IS NULL;
-- A student belongs to at most one partner at a time.
CREATE UNIQUE INDEX "FranchiseStudent_one_active_per_student" ON "FranchiseStudent"("studentUserId") WHERE "status" = 'ACTIVE';
-- One active primary payout beneficiary per partner.
CREATE UNIQUE INDEX "PayoutBeneficiary_one_primary_per_partner" ON "PayoutBeneficiary"("partnerId") WHERE "isPrimary" AND "status" <> 'DISABLED';
-- One open e-sign attempt per agreement; one open renewal per partner.
CREATE UNIQUE INDEX "ESignRequest_one_open_per_agreement" ON "ESignRequest"("agreementId") WHERE "status" IN ('CREATED', 'SENT');
CREATE UNIQUE INDEX "FranchiseRenewal_one_open_per_partner" ON "FranchiseRenewal"("partnerId") WHERE "status" IN ('PENDING_TERMS', 'OFFERED');

-- ---------- CHECK constraints ----------
ALTER TABLE "FranchiseApplication" ADD CONSTRAINT "FranchiseApplication_id_proof_required" CHECK ('ID_PROOF'::"FranchiseDocumentKind" = ANY ("requiredDocumentKinds"));
ALTER TABLE "FranchiseApplication" ADD CONSTRAINT "FranchiseApplication_investment_range" CHECK ("investmentCapacityInr" IS NULL OR "investmentCapacityInr" BETWEEN 0 AND 1000000000);
ALTER TABLE "FranchiseApplication" ADD CONSTRAINT "FranchiseApplication_refund_policy" CHECK ("refundPolicyVersion" > 0 AND length("refundPolicyText") > 0 AND length("refundPolicySha256") = 64);
ALTER TABLE "FranchiseApplication" ADD CONSTRAINT "FranchiseApplication_rejection_recorded" CHECK ("status" <> 'REJECTED' OR ("rejectionReason" IS NOT NULL AND "rejectedAt" IS NOT NULL));
ALTER TABLE "FranchiseApplication" ADD CONSTRAINT "FranchiseApplication_version_nonnegative" CHECK ("version" >= 0);
ALTER TABLE "FranchiseApplicationDocument" ADD CONSTRAINT "FranchiseApplicationDocument_size_hash" CHECK ("sizeBytes" > 0 AND length("sha256") = 64);
ALTER TABLE "FranchiseApplicationStatusHistory" ADD CONSTRAINT "FranchiseApplicationStatusHistory_actor_type" CHECK ("actorType" IN ('APPLICANT', 'ADMIN', 'SYSTEM'));
ALTER TABLE "FranchiseNotification" ADD CONSTRAINT "FranchiseNotification_status" CHECK ("status" IN ('SENT', 'FAILED'));

ALTER TABLE "FranchisePayment" ADD CONSTRAINT "FranchisePayment_amounts" CHECK ("totalAmountInPaise" > 0 AND "baseAmountInPaise" >= 0 AND "gstAmountInPaise" >= 0 AND "totalAmountInPaise" = "baseAmountInPaise" + "gstAmountInPaise");
ALTER TABLE "FranchisePayment" ADD CONSTRAINT "FranchisePayment_gst" CHECK ("gstMode" IN ('INCLUSIVE', 'EXCLUSIVE') AND "gstRateBps" BETWEEN 0 AND 2800);
ALTER TABLE "FranchisePayment" ADD CONSTRAINT "FranchisePayment_currency_inr" CHECK ("currency" = 'INR');
ALTER TABLE "FranchisePayment" ADD CONSTRAINT "FranchisePayment_refund_policy" CHECK ("refundPolicyVersion" > 0 AND length("refundPolicyText") > 0 AND length("refundPolicySha256") = 64);
ALTER TABLE "FranchisePayment" ADD CONSTRAINT "FranchisePayment_paid_recorded" CHECK ("status" NOT IN ('PAID', 'DUPLICATE_PAID') OR ("razorpayPaymentId" IS NOT NULL AND "paidAt" IS NOT NULL));

ALTER TABLE "GstInvoiceSequence" ADD CONSTRAINT "GstInvoiceSequence_next_positive" CHECK ("nextNumber" > 0);
ALTER TABLE "GstInvoice" ADD CONSTRAINT "GstInvoice_amounts" CHECK ("number" > 0 AND "taxableValueInPaise" >= 0 AND "cgstInPaise" >= 0 AND "sgstInPaise" >= 0 AND "igstInPaise" >= 0 AND "totalInPaise" = "taxableValueInPaise" + "cgstInPaise" + "sgstInPaise" + "igstInPaise");
ALTER TABLE "GstInvoice" ADD CONSTRAINT "GstInvoice_tax_split" CHECK ("cgstInPaise" = "sgstInPaise" AND ("igstInPaise" = 0 OR "cgstInPaise" = 0));
ALTER TABLE "GstCreditNote" ADD CONSTRAINT "GstCreditNote_amounts" CHECK ("number" > 0 AND "taxableValueInPaise" >= 0 AND "cgstInPaise" >= 0 AND "sgstInPaise" >= 0 AND "igstInPaise" >= 0 AND "totalInPaise" > 0 AND "totalInPaise" = "taxableValueInPaise" + "cgstInPaise" + "sgstInPaise" + "igstInPaise");

ALTER TABLE "FranchiseAgreement" ADD CONSTRAINT "FranchiseAgreement_term_and_hash" CHECK ("termMonths" > 0 AND length("contentSha256") = 64);
ALTER TABLE "FranchiseAgreement" ADD CONSTRAINT "FranchiseAgreement_acceptance_recorded" CHECK ("acceptedAt" IS NULL OR ("acceptedById" IS NOT NULL AND "acceptedName" IS NOT NULL AND "acceptedContentSha256" = "contentSha256"));
ALTER TABLE "ESignRequest" ADD CONSTRAINT "ESignRequest_hashes" CHECK (length("documentSha256") = 64 AND ("status" <> 'SIGNED' OR ("signedPdfKey" IS NOT NULL AND length("signedPdfSha256") = 64 AND "completedAt" IS NOT NULL)));
ALTER TABLE "FranchiseRenewal" ADD CONSTRAINT "FranchiseRenewal_term" CHECK ("termMonths" IS NULL OR "termMonths" > 0);

ALTER TABLE "FranchisePartner" ADD CONSTRAINT "FranchisePartner_term" CHECK ("agreementEndsAt" > "agreementStartsAt");
ALTER TABLE "FranchisePartner" ADD CONSTRAINT "FranchisePartner_status_dates" CHECK (("status" <> 'SUSPENDED' OR "suspendedAt" IS NOT NULL) AND ("status" <> 'DEACTIVATED' OR "deactivatedAt" IS NOT NULL));

ALTER TABLE "DistrictAllocation" ADD CONSTRAINT "DistrictAllocation_holder" CHECK ("applicationId" IS NOT NULL OR "partnerId" IS NOT NULL);
ALTER TABLE "DistrictAllocation" ADD CONSTRAINT "DistrictAllocation_status_dates" CHECK (
  ("status" <> 'RESERVED' OR "reservedAt" IS NOT NULL)
  AND ("status" <> 'ALLOCATED' OR ("partnerId" IS NOT NULL AND "allocatedAt" IS NOT NULL))
  AND ("status" <> 'SUSPENDED' OR ("partnerId" IS NOT NULL AND "suspendedAt" IS NOT NULL))
  AND (("status" = 'RELEASED') = ("releasedAt" IS NOT NULL))
  AND ("reservedUntil" IS NULL OR "reservedAt" IS NULL OR "reservedUntil" > "reservedAt"));

ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_version_hash" CHECK ("version" > 0 AND length("payloadSha256") = 64);
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_two_admin_publication" CHECK ("status" NOT IN ('PUBLISHED', 'SUPERSEDED') OR ("approvedById" IS NOT NULL AND "approvedById" <> "createdById" AND "publishedAt" IS NOT NULL));
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_superseded_dated" CHECK ("status" <> 'SUPERSEDED' OR "supersededAt" IS NOT NULL);

ALTER TABLE "AdminApprovalRequest" ADD CONSTRAINT "AdminApprovalRequest_two_admin" CHECK ("status" NOT IN ('APPROVED', 'EXECUTED') OR ("decidedById" IS NOT NULL AND "decidedById" <> "requestedById"));
ALTER TABLE "AdminApprovalRequest" ADD CONSTRAINT "AdminApprovalRequest_open_key" CHECK (("status" IN ('PENDING', 'APPROVED')) = ("openKey" IS NOT NULL));
ALTER TABLE "AdminApprovalRequest" ADD CONSTRAINT "AdminApprovalRequest_executed_dated" CHECK ("status" <> 'EXECUTED' OR "executedAt" IS NOT NULL);
ALTER TABLE "AdminApprovalRequest" ADD CONSTRAINT "AdminApprovalRequest_payload" CHECK (length("payloadSha256") = 64 AND length("reason") > 0);

ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_partner_scope" CHECK (("type" IN ('PARTNER_HELD', 'PARTNER_PAYABLE', 'PARTNER_RESERVE', 'PARTNER_DEBT')) = ("partnerId" IS NOT NULL));
ALTER TABLE "LedgerJournal" ADD CONSTRAINT "LedgerJournal_inputs_hash" CHECK (length("inputsSha256") = 64 AND length("idempotencyKey") > 0);
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_amount_positive" CHECK ("amountInPaise" > 0);

ALTER TABLE "EarningsLot" ADD CONSTRAINT "EarningsLot_amounts" CHECK ("amountInPaise" > 0 AND "remainingInPaise" >= 0 AND "remainingInPaise" <= "amountInPaise" AND "maturesAt" >= "capturedAt");
ALTER TABLE "EarningsLot" ADD CONSTRAINT "EarningsLot_matured_journal" CHECK ("status" <> 'MATURED' OR "maturedJournalId" IS NOT NULL);
ALTER TABLE "ReserveLot" ADD CONSTRAINT "ReserveLot_amounts" CHECK ("amountInPaise" > 0 AND "remainingInPaise" >= 0 AND "releasedInPaise" >= 0 AND "remainingInPaise" + "releasedInPaise" <= "amountInPaise");

ALTER TABLE "TdsDeduction" ADD CONSTRAINT "TdsDeduction_amounts" CHECK ("baseInPaise" >= 0 AND "amountInPaise" > 0 AND "amountInPaise" <= "baseInPaise" AND "rateBps" BETWEEN 0 AND 10000 AND "quarter" BETWEEN 1 AND 4 AND length("provisionReference") > 0);
ALTER TABLE "TdsCertificate" ADD CONSTRAINT "TdsCertificate_quarter" CHECK ("quarter" BETWEEN 1 AND 4);

ALTER TABLE "PaymentFeeRecord" ADD CONSTRAINT "PaymentFeeRecord_amounts" CHECK ("feeInPaise" >= 0 AND "feeTaxInPaise" >= 0);
ALTER TABLE "OrderRefund" ADD CONSTRAINT "OrderRefund_amount_positive" CHECK ("amountInPaise" > 0);
ALTER TABLE "PaymentDispute" ADD CONSTRAINT "PaymentDispute_amount_positive" CHECK ("amountInPaise" > 0);

ALTER TABLE "PayoutBeneficiary" ADD CONSTRAINT "PayoutBeneficiary_verified_dated" CHECK (("status" <> 'VERIFIED' OR "verifiedAt" IS NOT NULL) AND length("maskedIdentifier") > 0);
ALTER TABLE "SettlementSchedule" ADD CONSTRAINT "SettlementSchedule_time" CHECK ("dayOfWeek" BETWEEN 1 AND 7 AND ("executionMinuteOfDay" IS NULL OR "executionMinuteOfDay" BETWEEN 0 AND 1439) AND (NOT "enabled" OR "executionMinuteOfDay" IS NOT NULL));
ALTER TABLE "SettlementBatch" ADD CONSTRAINT "SettlementBatch_totals" CHECK ("lineCount" >= 0 AND "totalPayoutInPaise" >= 0);
ALTER TABLE "SettlementLine" ADD CONSTRAINT "SettlementLine_amounts" CHECK ("payoutAmountInPaise" >= 0 AND "payoutAmountInPaise" <= GREATEST("payableInPaise", 0) AND length("inputsSha256") = 64);
ALTER TABLE "SettlementLine" ADD CONSTRAINT "SettlementLine_skip_reason" CHECK (("status" = 'SKIPPED') = ("skipReason" IS NOT NULL));
ALTER TABLE "FranchisePayout" ADD CONSTRAINT "FranchisePayout_amount_positive" CHECK ("amountInPaise" > 0);
ALTER TABLE "FranchisePayout" ADD CONSTRAINT "FranchisePayout_journals" CHECK (("status" = 'CREATED' OR "initJournalId" IS NOT NULL) AND ("status" <> 'PAID' OR ("providerPayoutId" IS NOT NULL AND "finalizedAt" IS NOT NULL AND "finalJournalId" IS NOT NULL)));

-- ---------- Append-only tables ----------
-- UPDATE is always refused. DELETE/TRUNCATE are refused unless the session sets
-- eta.financial_maintenance = 'on' (used only by test cleanup on throwaway databases; never by the app).
CREATE FUNCTION eta_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'append-only table %: UPDATE is not allowed', TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  IF coalesce(current_setting('eta.financial_maintenance', true), '') <> 'on' THEN
    RAISE EXCEPTION 'append-only table %: % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NULL END;
END $$;

CREATE TRIGGER "LedgerJournal_append_only" BEFORE UPDATE OR DELETE ON "LedgerJournal" FOR EACH ROW EXECUTE FUNCTION eta_append_only();
CREATE TRIGGER "LedgerJournal_no_truncate" BEFORE TRUNCATE ON "LedgerJournal" FOR EACH STATEMENT EXECUTE FUNCTION eta_append_only();
CREATE TRIGGER "LedgerEntry_append_only" BEFORE UPDATE OR DELETE ON "LedgerEntry" FOR EACH ROW EXECUTE FUNCTION eta_append_only();
CREATE TRIGGER "LedgerEntry_no_truncate" BEFORE TRUNCATE ON "LedgerEntry" FOR EACH STATEMENT EXECUTE FUNCTION eta_append_only();
CREATE TRIGGER "FranchiseApplicationStatusHistory_append_only" BEFORE UPDATE OR DELETE ON "FranchiseApplicationStatusHistory" FOR EACH ROW EXECUTE FUNCTION eta_append_only();
CREATE TRIGGER "FranchiseApplicationDocument_append_only" BEFORE UPDATE OR DELETE ON "FranchiseApplicationDocument" FOR EACH ROW EXECUTE FUNCTION eta_append_only();
CREATE TRIGGER "FranchisePartnerEvent_append_only" BEFORE UPDATE OR DELETE ON "FranchisePartnerEvent" FOR EACH ROW EXECUTE FUNCTION eta_append_only();
CREATE TRIGGER "DistrictAllocationEvent_append_only" BEFORE UPDATE OR DELETE ON "DistrictAllocationEvent" FOR EACH ROW EXECUTE FUNCTION eta_append_only();
CREATE TRIGGER "TdsDeduction_append_only" BEFORE UPDATE OR DELETE ON "TdsDeduction" FOR EACH ROW EXECUTE FUNCTION eta_append_only();
CREATE TRIGGER "FranchisePayoutEvent_append_only" BEFORE UPDATE OR DELETE ON "FranchisePayoutEvent" FOR EACH ROW EXECUTE FUNCTION eta_append_only();
CREATE TRIGGER "GstInvoice_append_only" BEFORE UPDATE OR DELETE ON "GstInvoice" FOR EACH ROW EXECUTE FUNCTION eta_append_only();
CREATE TRIGGER "GstCreditNote_append_only" BEFORE UPDATE OR DELETE ON "GstCreditNote" FOR EACH ROW EXECUTE FUNCTION eta_append_only();

-- ---------- Ledger balance: checked at COMMIT for every journal touched ----------
CREATE FUNCTION eta_ledger_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  jid text; n integer; dr numeric; cr numeric;
BEGIN
  -- Separate branches: PL/pgSQL resolves a record field only when its statement runs.
  IF TG_TABLE_NAME = 'LedgerJournal' THEN
    jid := NEW."id";
  ELSE
    jid := NEW."journalId";
  END IF;
  SELECT count(*),
         coalesce(sum("amountInPaise") FILTER (WHERE "direction" = 'DEBIT'), 0),
         coalesce(sum("amountInPaise") FILTER (WHERE "direction" = 'CREDIT'), 0)
    INTO n, dr, cr FROM "LedgerEntry" WHERE "journalId" = jid;
  IF n < 2 THEN
    RAISE EXCEPTION 'ledger journal % has % entries (at least 2 required)', jid, n USING ERRCODE = 'P0001';
  END IF;
  IF dr <> cr THEN
    RAISE EXCEPTION 'ledger journal % is unbalanced: debits % <> credits %', jid, dr, cr USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "LedgerJournal_balanced" AFTER INSERT ON "LedgerJournal" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION eta_ledger_journal_balanced();
CREATE CONSTRAINT TRIGGER "LedgerEntry_balanced" AFTER INSERT ON "LedgerEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION eta_ledger_journal_balanced();

-- ---------- Published policies are immutable ----------
CREATE FUNCTION eta_policy_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'policy version % (%) cannot be deleted', OLD."id", OLD."status" USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'DRAFT' AND (NEW."payload" IS DISTINCT FROM OLD."payload" OR NEW."payloadSha256" IS DISTINCT FROM OLD."payloadSha256"
      OR NEW."domain" IS DISTINCT FROM OLD."domain" OR NEW."version" IS DISTINCT FROM OLD."version" OR NEW."createdById" IS DISTINCT FROM OLD."createdById") THEN
    RAISE EXCEPTION 'policy version % is % — its content is frozen', OLD."id", OLD."status" USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" IN ('PUBLISHED', 'SUPERSEDED', 'REJECTED') THEN
    IF NOT (OLD."status" = 'PUBLISHED' AND NEW."status" = 'SUPERSEDED'
            AND NEW."approvedById" IS NOT DISTINCT FROM OLD."approvedById"
            AND NEW."approvalRequestId" IS NOT DISTINCT FROM OLD."approvalRequestId"
            AND NEW."publishedAt" IS NOT DISTINCT FROM OLD."publishedAt"
            AND NEW."effectiveFrom" IS NOT DISTINCT FROM OLD."effectiveFrom") THEN
      RAISE EXCEPTION 'policy version % is % — only PUBLISHED → SUPERSEDED is allowed', OLD."id", OLD."status" USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "PolicyVersion_guard" BEFORE UPDATE OR DELETE ON "PolicyVersion" FOR EACH ROW EXECUTE FUNCTION eta_policy_version_guard();

-- ---------- Snapshots that must never change once written ----------
CREATE FUNCTION eta_franchise_payment_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."applicationId", NEW."baseAmountInPaise", NEW."gstAmountInPaise", NEW."totalAmountInPaise", NEW."currency", NEW."gstMode", NEW."gstRateBps",
      NEW."policyVersionId", NEW."refundPolicyVersion", NEW."refundPolicyText", NEW."refundPolicySha256", NEW."razorpayOrderId")
     IS DISTINCT FROM
     (OLD."applicationId", OLD."baseAmountInPaise", OLD."gstAmountInPaise", OLD."totalAmountInPaise", OLD."currency", OLD."gstMode", OLD."gstRateBps",
      OLD."policyVersionId", OLD."refundPolicyVersion", OLD."refundPolicyText", OLD."refundPolicySha256", OLD."razorpayOrderId") THEN
    RAISE EXCEPTION 'franchise payment % snapshot fields are immutable', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  IF OLD."razorpayPaymentId" IS NOT NULL AND NEW."razorpayPaymentId" IS DISTINCT FROM OLD."razorpayPaymentId" THEN
    RAISE EXCEPTION 'franchise payment % razorpayPaymentId is already recorded', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" IN ('PAID', 'DUPLICATE_PAID') AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'franchise payment % is % — status is final', OLD."id", OLD."status" USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "FranchisePayment_snapshot" BEFORE UPDATE ON "FranchisePayment" FOR EACH ROW EXECUTE FUNCTION eta_franchise_payment_snapshot();

CREATE FUNCTION eta_franchise_agreement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."applicationId", NEW."templateId", NEW."templateVersion", NEW."policyVersionId", NEW."termMonths", NEW."renderedText", NEW."contentSha256", NEW."generatedAt")
     IS DISTINCT FROM
     (OLD."applicationId", OLD."templateId", OLD."templateVersion", OLD."policyVersionId", OLD."termMonths", OLD."renderedText", OLD."contentSha256", OLD."generatedAt") THEN
    RAISE EXCEPTION 'agreement % content is immutable', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  IF OLD."acceptedAt" IS NOT NULL AND (NEW."acceptedAt", NEW."acceptedById", NEW."acceptedContentSha256", NEW."acceptedName", NEW."ipHash", NEW."userAgentHash")
     IS DISTINCT FROM (OLD."acceptedAt", OLD."acceptedById", OLD."acceptedContentSha256", OLD."acceptedName", OLD."ipHash", OLD."userAgentHash") THEN
    RAISE EXCEPTION 'agreement % acceptance is already recorded', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  IF (OLD."pdfStorageKey" IS NOT NULL AND NEW."pdfStorageKey" IS DISTINCT FROM OLD."pdfStorageKey")
     OR (OLD."pdfSha256" IS NOT NULL AND NEW."pdfSha256" IS DISTINCT FROM OLD."pdfSha256") THEN
    RAISE EXCEPTION 'agreement % PDF is already recorded', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "FranchiseAgreement_guard" BEFORE UPDATE ON "FranchiseAgreement" FOR EACH ROW EXECUTE FUNCTION eta_franchise_agreement_guard();

-- Lots only ever shrink (remaining) or release (released); their original amount never changes.
CREATE FUNCTION eta_lot_monotonic() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."amountInPaise" <> OLD."amountInPaise" OR NEW."partnerId" <> OLD."partnerId" OR NEW."remainingInPaise" > OLD."remainingInPaise" THEN
    RAISE EXCEPTION '% % may only decrease its remaining amount', TG_TABLE_NAME, OLD."id" USING ERRCODE = 'P0001';
  END IF;
  IF TG_TABLE_NAME = 'ReserveLot' THEN
    IF NEW."releasedInPaise" < OLD."releasedInPaise" THEN
      RAISE EXCEPTION 'ReserveLot % released amount cannot decrease', OLD."id" USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "EarningsLot_monotonic" BEFORE UPDATE ON "EarningsLot" FOR EACH ROW EXECUTE FUNCTION eta_lot_monotonic();
CREATE TRIGGER "ReserveLot_monotonic" BEFORE UPDATE ON "ReserveLot" FOR EACH ROW EXECUTE FUNCTION eta_lot_monotonic();

-- Credit notes never exceed their invoice, per tax component (the invoice row is locked first).
CREATE FUNCTION eta_credit_note_limit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inv "GstInvoice"%ROWTYPE; t numeric; c numeric; s numeric; i numeric;
BEGIN
  SELECT * INTO inv FROM "GstInvoice" WHERE "id" = NEW."invoiceId" FOR UPDATE;
  SELECT coalesce(sum("taxableValueInPaise"), 0), coalesce(sum("cgstInPaise"), 0), coalesce(sum("sgstInPaise"), 0), coalesce(sum("igstInPaise"), 0)
    INTO t, c, s, i FROM "GstCreditNote" WHERE "invoiceId" = NEW."invoiceId";
  IF t + NEW."taxableValueInPaise" > inv."taxableValueInPaise" OR c + NEW."cgstInPaise" > inv."cgstInPaise"
     OR s + NEW."sgstInPaise" > inv."sgstInPaise" OR i + NEW."igstInPaise" > inv."igstInPaise" THEN
    RAISE EXCEPTION 'credit notes would exceed invoice %', inv."invoiceNo" USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "GstCreditNote_limit" BEFORE INSERT ON "GstCreditNote" FOR EACH ROW EXECUTE FUNCTION eta_credit_note_limit();

-- ---------- Company ledger accounts (structural, not a business decision) ----------
INSERT INTO "LedgerAccount" ("id", "type", "partnerId") VALUES
  ('ledger_eta_revenue', 'ETA_REVENUE', NULL),
  ('ledger_gst_payable', 'GST_PAYABLE', NULL),
  ('ledger_gateway_fees', 'GATEWAY_FEES', NULL),
  ('ledger_gateway_fee_recovery', 'GATEWAY_FEE_RECOVERY', NULL),
  ('ledger_tds_payable', 'TDS_PAYABLE', NULL),
  ('ledger_refund_chargeback_adjustments', 'REFUND_CHARGEBACK_ADJUSTMENTS', NULL),
  ('ledger_razorpay_clearing', 'RAZORPAY_CLEARING', NULL),
  ('ledger_sales_clearing', 'SALES_CLEARING', NULL),
  ('ledger_payout_in_transit', 'PAYOUT_IN_TRANSIT', NULL),
  ('ledger_payout_fees', 'PAYOUT_FEES', NULL),
  ('ledger_bank', 'BANK', NULL);
