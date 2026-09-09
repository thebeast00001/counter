import type { ArchetypeKey, BusinessShape, Vocabulary } from '@/domain/model';

/**
 * Archetypes are starting points, not templates.
 *
 * Onboarding picks the closest one and then *adjusts its weights* from what the
 * owner actually said. Two gyms can leave onboarding with different shapes, and
 * therefore different products — which is the whole point. Nothing downstream
 * ever branches on `archetype`; it branches on `shape`.
 */
export type Archetype = {
  key: ArchetypeKey;
  label: string;
  /** Words that suggest this archetype in a plain-language description. */
  cues: string[];
  vocabulary: Vocabulary;
  shape: BusinessShape;
  /** Offerings pre-created so the first screen is not empty. */
  starterOfferings: { name: string; price: number; durationDays: number | null }[];
};

const v = (
  party: [string, string],
  commitment: [string, string],
  engagement: [string, string],
  offering: [string, string],
  person: [string, string],
  resource: [string, string],
): Vocabulary => ({
  party: { one: party[0], many: party[1] },
  commitment: { one: commitment[0], many: commitment[1] },
  engagement: { one: engagement[0], many: engagement[1] },
  offering: { one: offering[0], many: offering[1] },
  person: { one: person[0], many: person[1] },
  resource: { one: resource[0], many: resource[1] },
  money: { one: 'Payment', many: 'Payments' },
  obligation: { one: 'Follow-up', many: 'Follow-ups' },
});

export const ARCHETYPES: Record<ArchetypeKey, Archetype> = {
  gym: {
    key: 'gym',
    label: 'Gym or fitness studio',
    cues: ['gym', 'fitness', 'workout', 'trainer', 'membership', 'crossfit', 'yoga', 'zumba'],
    vocabulary: v(
      ['Member', 'Members'],
      ['Membership', 'Memberships'],
      ['Check-in', 'Check-ins'],
      ['Plan', 'Plans'],
      ['Trainer', 'Trainers'],
      ['Floor', 'Floors'],
    ),
    shape: {
      commitmentWeight: 0.9,
      engagementFreq: 'high',
      engagementValue: 'low',
      capacityBound: false,
      staffAttribution: false,
      paymentTiming: 'before',
    },
    starterOfferings: [
      { name: 'Monthly', price: 1500, durationDays: 30 },
      { name: 'Quarterly', price: 4000, durationDays: 90 },
      { name: 'Yearly', price: 12000, durationDays: 365 },
    ],
  },

  tuition: {
    key: 'tuition',
    label: 'Tuition or coaching',
    cues: ['tuition', 'coaching', 'teach', 'student', 'class', 'batch', 'school', 'academy', 'maths', 'science'],
    vocabulary: v(
      ['Student', 'Students'],
      ['Enrolment', 'Enrolments'],
      ['Class', 'Classes'],
      ['Course', 'Courses'],
      ['Teacher', 'Teachers'],
      ['Batch', 'Batches'],
    ),
    shape: {
      commitmentWeight: 0.75,
      engagementFreq: 'high',
      engagementValue: 'low',
      capacityBound: true,
      staffAttribution: true,
      paymentTiming: 'after',
    },
    starterOfferings: [
      { name: 'Monthly fee', price: 2000, durationDays: 30 },
      { name: 'Term fee', price: 5500, durationDays: 120 },
    ],
  },

  salon: {
    key: 'salon',
    label: 'Salon or spa',
    cues: ['salon', 'spa', 'parlour', 'parlor', 'hair', 'beauty', 'stylist', 'barber', 'nails'],
    vocabulary: v(
      ['Client', 'Clients'],
      ['Package', 'Packages'],
      ['Appointment', 'Appointments'],
      ['Service', 'Services'],
      ['Stylist', 'Stylists'],
      ['Chair', 'Chairs'],
    ),
    shape: {
      commitmentWeight: 0.2,
      engagementFreq: 'medium',
      engagementValue: 'medium',
      capacityBound: true,
      staffAttribution: true,
      paymentTiming: 'at',
    },
    starterOfferings: [
      { name: 'Haircut', price: 400, durationDays: null },
      { name: 'Colour', price: 2500, durationDays: null },
      { name: 'Facial', price: 1200, durationDays: null },
    ],
  },

  restaurant: {
    key: 'restaurant',
    label: 'Restaurant or café',
    cues: ['restaurant', 'cafe', 'café', 'kitchen', 'food', 'menu', 'dhaba', 'bakery', 'cloud kitchen'],
    vocabulary: v(
      ['Guest', 'Guests'],
      ['Subscription', 'Subscriptions'],
      ['Order', 'Orders'],
      ['Item', 'Items'],
      ['Team member', 'Staff'],
      ['Table', 'Tables'],
    ),
    shape: {
      commitmentWeight: 0.05,
      engagementFreq: 'medium',
      engagementValue: 'medium',
      capacityBound: true,
      staffAttribution: false,
      paymentTiming: 'at',
    },
    starterOfferings: [
      { name: 'Thali', price: 180, durationDays: null },
      { name: 'Beverages', price: 60, durationDays: null },
    ],
  },

  mechanic: {
    key: 'mechanic',
    label: 'Garage or repair shop',
    cues: ['mechanic', 'garage', 'repair', 'service centre', 'service center', 'vehicle', 'car', 'bike', 'workshop'],
    vocabulary: v(
      ['Customer', 'Customers'],
      ['Service plan', 'Service plans'],
      ['Job', 'Jobs'],
      ['Service', 'Services'],
      ['Mechanic', 'Mechanics'],
      ['Bay', 'Bays'],
    ),
    shape: {
      commitmentWeight: 0.15,
      engagementFreq: 'low',
      engagementValue: 'high',
      capacityBound: true,
      staffAttribution: false,
      paymentTiming: 'after',
    },
    starterOfferings: [
      { name: 'General service', price: 3500, durationDays: null },
      { name: 'Oil change', price: 1200, durationDays: null },
    ],
  },

  clinic: {
    key: 'clinic',
    label: 'Clinic or practice',
    cues: ['clinic', 'doctor', 'dental', 'dentist', 'patient', 'physio', 'therapy', 'consultation'],
    vocabulary: v(
      ['Patient', 'Patients'],
      ['Treatment plan', 'Treatment plans'],
      ['Visit', 'Visits'],
      ['Treatment', 'Treatments'],
      ['Practitioner', 'Practitioners'],
      ['Room', 'Rooms'],
    ),
    shape: {
      commitmentWeight: 0.3,
      engagementFreq: 'low',
      engagementValue: 'high',
      capacityBound: true,
      staffAttribution: true,
      paymentTiming: 'at',
    },
    starterOfferings: [
      { name: 'Consultation', price: 600, durationDays: null },
      { name: 'Follow-up', price: 300, durationDays: null },
    ],
  },

  generic: {
    key: 'generic',
    label: 'Something else',
    cues: [],
    vocabulary: v(
      ['Customer', 'Customers'],
      ['Plan', 'Plans'],
      ['Visit', 'Visits'],
      ['Service', 'Services'],
      ['Team member', 'Staff'],
      ['Resource', 'Resources'],
    ),
    shape: {
      commitmentWeight: 0.3,
      engagementFreq: 'medium',
      engagementValue: 'medium',
      capacityBound: false,
      staffAttribution: false,
      paymentTiming: 'at',
    },
    starterOfferings: [{ name: 'Standard service', price: 1000, durationDays: null }],
  },
};

export const ARCHETYPE_ORDER: ArchetypeKey[] = [
  'gym',
  'tuition',
  'salon',
  'restaurant',
  'mechanic',
  'clinic',
  'generic',
];
