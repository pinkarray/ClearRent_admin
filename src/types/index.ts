import { Timestamp } from "firebase/firestore";

export interface ClearRentUser {
  id: string;
  uid: string;
  fullName: string;
  fullNameLower?: string;
  email: string;
  phone?: string;
  accountType: "landlord" | "tenant" | "agent";
  profileCompleted: boolean;
  emailVerified: boolean;
  profileImageUrl?: string;
  bvn?: string;

  // Verification
  verificationStatus?: "none" | "pending" | "verified" | "rejected";
  isVerified?: boolean;
  verificationSubmittedAt?: Date;
  verificationReviewedAt?: Date;
  rejectionReason?: string;
  verificationDocs?: Record<string, string>;
  verificationPaymentProofUrl?: string;
  verificationPaymentAmount?: number;
  verificationPaymentStatus?: string;

  // Agent-specific
  baseLocation?: string;
  serviceAreas?: string[];
  rating?: number;
  totalInspections?: number;
  totalRatings?: number;

  // Landlord-specific
  allowsCalls?: boolean;

  // Timestamps
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PropertyData {
  id: string;
  title: string;
  address: string;
  city?: string;
  propertyType: string;
  price: number;
  rentFrequency: string;
  landlordId: string;
  landlordName?: string;
  isAvailable: boolean;
  amenities: string[];
  images: string[];
  slots?: number;
  createdAt?: Date;
}

export interface IssueData {
  id: string;
  title: string;
  description?: string;
  category: string;
  status: "open" | "in_progress" | "pending_confirmation" | "resolved";
  priority: "low" | "medium" | "high";
  propertyId: string;
  propertyTitle: string;
  landlordId: string;
  tenantId: string;
  tenantName: string;
  images?: string[];
  createdAt?: Date;
  updatedAt?: Date;
  resolvedAt?: Date;
}

// Helper to convert Firestore timestamps
export function parseTimestamp(val: any): Date | undefined {
  if (!val) return undefined;
  if (val instanceof Timestamp) return val.toDate();
  if (val?.seconds) return new Date(val.seconds * 1000);
  if (val instanceof Date) return val;
  return undefined;
}
