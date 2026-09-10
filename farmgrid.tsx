import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Tractor,
  CloudRain,
  Sun,
  Wind,
  Droplets,
  Thermometer,
  AlertTriangle,
  RefreshCw,
  Zap,
  Calendar,
  Clock,
  User,
  MapPin,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Play,
  Wifi,
  WifiOff,
  RotateCw,
  Sparkles,
  Layers,
  Briefcase,
  Wrench,
  Search,
  Sliders,
  ChevronDown,
  PlusCircle,
  Trash2,
  Compass,
  Navigation,
  LogOut,
  Info,
  Sprout,
  Truck,
  Cpu,
  Building2,
  UserCheck,
} from 'lucide-react';

/* ==========================================================================
   1. TYPES & DATA INTERFACES
   ========================================================================== */

export type UserRole = 'FARMER' | 'RESOURCE_OWNER' | 'BUSINESS' | 'ADMIN';

export type CropStage =
  | 'EARLY_VEGETATIVE'
  | 'GROWING'
  | 'FLOWERING'
  | 'HARVEST_READY'
  | 'PEAK_RIPENING';

export interface IUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  location: string;
}

export interface IFarmLocation {
  id: string;
  farmerId: string;
  farmName: string;
  village: string;
  district: string;
  state: string;
  fullAddress: string;
  latitude: number;
  longitude: number;
  farmSize: number;
  cropType: string;
  isPrimary: boolean;
}

export interface IResource {
  id: string;
  name: string;
  type: string;
  ownerId: string;
  location: string;
  latitude: number;
  longitude: number;
  serviceRadius: number;
  availability: 'AVAILABLE' | 'BOOKED' | 'UNDER_MAINTENANCE' | 'UNAVAILABLE';
  maintenanceStatus: boolean;
  operatingHours: { start: string; end: string };
  pricing: { perHour: number; currency: string };
  capabilities: string[];
}

export interface ScoreBreakdown {
  urgencyScore: number;    // max 25
  weatherScore: number;    // max 25
  cropScore: number;       // max 20
  waitingScore: number;    // max 15
  logisticsScore: number;  // max 10
  constraintScore: number; // max 5
}

export interface IResourceRequest {
  id: string;
  farmerId: string;
  farmerName: string;
  resourceType: string;
  requestedResource?: string;
  farmLocationId: string;
  earliestStart: string;
  latestEnd: string;
  duration: number;
  cropType: string;
  cropStage: CropStage;
  urgencyReason: string;
  weatherRisk?: string;
  latitude: number;
  longitude: number;
  priorityScore: number;
  scoreBreakdown: ScoreBreakdown;
  priorityExplanation: string;
  status: 'PENDING' | 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  createdAt: string;
  offlineCreated?: boolean;
}

export interface IBooking {
  id: string;
  resourceId: string;
  farmerId: string;
  requestId: string;
  startTime: string;
  endTime: string;
  travelTime: number; // in mins
  bufferTime: number; // in mins
  status: 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'DISRUPTED';
  disruptionReason?: string;
  reallocatedFromId?: string;
}

export interface FeasibleSlot {
  slotId: string;
  resourceId: string;
  resourceName: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  distanceKm: number;
  travelTimeMinutes: number;
  bufferTimeMinutes: number;
  score: number;
  isRecommended: boolean;
}

export interface OfflineQueueItem {
  localId: string;
  resourceType: string;
  requestedResource?: string;
  farmLocationId: string;
  earliestStart: string;
  latestEnd: string;
  duration: number;
  cropType: string;
  cropStage: CropStage;
  urgencyReason: string;
  latitude: number;
  longitude: number;
  createdAt: string;
  status: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';
  errorMessage?: string;
}

/* ==========================================================================
   2. CORE ALGORITHMIC ENGINES (DETERMINISTIC & TRANSPARENT)
   ========================================================================== */

/**
 * Great-circle distance using Haversine formula
 */
export function calculateHaversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(toRad(lat1)) * Math.cos(toRad(lat2));
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

/**
 * Logistics Lead Time Calculator
 */
export function calculateLogistics(
  resLat: number,
  resLon: number,
  farmLat: number,
  farmLon: number,
  speedKmh = 30,
  baseBufferMins = 20
) {
  const distanceKm = calculateHaversineKm(resLat, resLon, farmLat, farmLon);
  const travelTimeMinutes = Math.ceil((distanceKm / Math.max(speedKmh, 5)) * 60);
  const bufferTimeMinutes = baseBufferMins + Math.floor(distanceKm / 20) * 5;
  return { distanceKm, travelTimeMinutes, bufferTimeMinutes, totalLeadMins: travelTimeMinutes + bufferTimeMinutes };
}

/**
 * Deterministic 0–100 Priority Engine
 */
export function calculatePriorityScore(params: {
  earliestStart: string;
  latestEnd: string;
  cropType: string;
  cropStage: CropStage;
  urgencyReason?: string;
  createdAt: string;
  weatherCondition?: string;
  weatherRiskScore?: number;
  distanceKm?: number;
}): { totalScore: number; scoreBreakdown: ScoreBreakdown; explanation: string } {
  const now = new Date();
  const latestEndDate = new Date(params.latestEnd);
  const createdDate = new Date(params.createdAt);

  // 1. Urgency / Deadline Proximity (Max 25 pts)
  const hoursUntilDeadline = Math.max(0, (latestEndDate.getTime() - now.getTime()) / (1000 * 60 * 60));
  let urgencyScore = 3;
  let urgencyText = 'flexible operational window';
  if (hoursUntilDeadline <= 12) {
    urgencyScore = 25;
    urgencyText = 'critical deadline (<12 hrs remaining)';
  } else if (hoursUntilDeadline <= 24) {
    urgencyScore = 21;
    urgencyText = 'urgent deadline (<24 hrs remaining)';
  } else if (hoursUntilDeadline <= 48) {
    urgencyScore = 16;
    urgencyText = 'near-term deadline (<48 hrs remaining)';
  } else if (hoursUntilDeadline <= 72) {
    urgencyScore = 11;
    urgencyText = 'moderate window (2-3 days)';
  }

  // 2. Weather Risk Exposure (Max 25 pts)
  let weatherScore = params.weatherRiskScore !== undefined ? params.weatherRiskScore : 3;
  let weatherText = 'favorable weather conditions';
  const cond = (params.weatherCondition || 'Clear').toLowerCase();
  if (params.weatherRiskScore === undefined) {
    if (cond.includes('hail')) { weatherScore = 25; weatherText = 'catastrophic hail risk'; }
    else if (cond.includes('storm')) { weatherScore = 24; weatherText = 'severe storm warning'; }
    else if (cond.includes('thunderstorm')) { weatherScore = 22; weatherText = 'thunderstorm and squall alert'; }
    else if (cond.includes('heavy rain')) { weatherScore = 20; weatherText = 'heavy rainfall expected'; }
    else if (cond.includes('light rain')) { weatherScore = 12; weatherText = 'moderate precipitation forecast'; }
    else { weatherScore = 2; weatherText = 'clear and stable weather'; }
  } else {
    weatherText = `weather risk score of ${weatherScore} pts`;
  }

  // 3. Crop Readiness / Biological Stage (Max 20 pts)
  let cropScore = 4;
  let cropText = 'early vegetative growth';
  switch (params.cropStage) {
    case 'PEAK_RIPENING': cropScore = 20; cropText = 'peak ripening stage with critical degradation risk'; break;
    case 'HARVEST_READY': cropScore = 18; cropText = 'harvest-ready crop requiring immediate collection'; break;
    case 'FLOWERING': cropScore = 14; cropText = 'flowering stage sensitive to timing windows'; break;
    case 'GROWING': cropScore = 9; cropText = 'active vegetative growth stage'; break;
    case 'EARLY_VEGETATIVE': default: cropScore = 4; cropText = 'early vegetative stage with broader flexibility'; break;
  }

  // 4. Queue Waiting Time (Max 15 pts) - Anti-Starvation
  const hoursWaiting = Math.max(0, (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60));
  const waitingScore = Math.min(15, Math.floor(hoursWaiting * 1.5));
  const waitingText = hoursWaiting >= 2 ? `waiting ${Math.round(hoursWaiting * 10) / 10}h in queue` : 'recently submitted';

  // 5. Distance & Logistics Overhead (Max 10 pts)
  const dist = params.distanceKm ?? 8;
  let logisticsScore = 8;
  let logisticsText = 'optimal transit proximity';
  if (dist <= 5) { logisticsScore = 10; logisticsText = `immediate local radius (${dist} km)`; }
  else if (dist <= 15) { logisticsScore = 8; logisticsText = `short transit distance (${dist} km)`; }
  else if (dist <= 30) { logisticsScore = 5; logisticsText = `moderate transit distance (${dist} km)`; }
  else { logisticsScore = 2; logisticsText = `extended transit distance (${dist} km)`; }

  // 6. Resource Constraints (Max 5 pts)
  const constraintScore = 4;

  const totalScore = Math.min(100, Math.max(0, urgencyScore + weatherScore + cropScore + waitingScore + logisticsScore + constraintScore));
  const explanation = `Prioritized with score ${totalScore}/100: ${cropText} (${cropScore}/20), ${weatherText} (${weatherScore}/25), ${urgencyText} (${urgencyScore}/25), ${waitingText} (${waitingScore}/15), and ${logisticsText} (${logisticsScore}/10).`;

  return {
    totalScore,
    scoreBreakdown: { urgencyScore, weatherScore, cropScore, waitingScore, logisticsScore, constraintScore },
    explanation,
  };
}

/**
 * Overlap detection: startA < endB && endA > startB
 */
export function intervalsOverlap(
  startA: string | Date,
  endA: string | Date,
  startB: string | Date,
  endB: string | Date
): boolean {
  return new Date(startA).getTime() < new Date(endB).getTime() && new Date(endA).getTime() > new Date(startB).getTime();
}

/**
 * Feasible Slot Finder for a resource
 */
export function findFeasibleSlots(
  request: { earliestStart: string; latestEnd: string; duration: number; latitude: number; longitude: number },
  resource: IResource,
  existingBookings: IBooking[]
): FeasibleSlot[] {
  if (resource.maintenanceStatus || resource.availability === 'UNDER_MAINTENANCE' || resource.availability === 'UNAVAILABLE') {
    return [];
  }

  const log = calculateLogistics(resource.latitude, resource.longitude, request.latitude, request.longitude);
  if (log.distanceKm > resource.serviceRadius) return [];

  const reqEarliest = new Date(request.earliestStart).getTime();
  const reqLatest = new Date(request.latestEnd).getTime();
  const durationMs = request.duration * 3600000;
  const leadMs = log.totalLeadMins * 60000;

  const activeResBookings = existingBookings.filter(
    (b) => b.resourceId === resource.id && b.status !== 'CANCELLED' && b.status !== 'DISRUPTED'
  );

  const slots: FeasibleSlot[] = [];
  let candidate = reqEarliest;
  let idx = 1;

  while (candidate + durationMs <= reqLatest) {
    let collides = false;
    for (const b of activeResBookings) {
      const bStart = new Date(b.startTime).getTime() - leadMs;
      const bEnd = new Date(b.endTime).getTime() + (b.travelTime + b.bufferTime) * 60000;
      if (candidate < bEnd && candidate + durationMs > bStart) {
        collides = true;
        break;
      }
    }

    if (!collides) {
      const delayHours = (candidate - reqEarliest) / 3600000;
      const score = Math.max(10, Math.round(100 - delayHours * 4 - log.distanceKm));

      slots.push({
        slotId: `slot-${resource.id}-${idx++}`,
        resourceId: resource.id,
        resourceName: resource.name,
        startTime: new Date(candidate).toISOString(),
        endTime: new Date(candidate + durationMs).toISOString(),
        durationHours: request.duration,
        distanceKm: log.distanceKm,
        travelTimeMinutes: log.travelTimeMinutes,
        bufferTimeMinutes: log.bufferTimeMinutes,
        score,
        isRecommended: false,
      });

      candidate += Math.max(durationMs, 3600000);
      continue;
    }

    candidate += 30 * 60000; // 30 min step
  }

  if (slots.length > 0) {
    slots.sort((a, b) => b.score - a.score);
    slots[0].isRecommended = true;
  }

  return slots;
}

/* ==========================================================================
   3. SYNTHETIC REALISTIC SEED DATA (ALL 4 DEMO SCENARIOS BUILT-IN)
   ========================================================================== */

const SEED_USERS: IUser[] = [
  { id: 'usr-farmer-1', name: 'Ravi Kumar (Demo Farmer)', email: 'farmer@farmgrid.com', phone: '9810123456', role: 'FARMER', location: 'Sahnewal, Ludhiana' },
  { id: 'usr-farmer-2', name: 'Sunita Devi', email: 'sunita@farmgrid.com', phone: '9820011111', role: 'FARMER', location: 'Khanna, Punjab' },
  { id: 'usr-farmer-3', name: 'Ramesh Patel', email: 'ramesh@farmgrid.com', phone: '9820022222', role: 'FARMER', location: 'Jagraon, Punjab' },
  { id: 'usr-farmer-4', name: 'Anita Sharma', email: 'anita@farmgrid.com', phone: '9820033333', role: 'FARMER', location: 'Doraha, Punjab' },
  { id: 'usr-farmer-5', name: 'Gurpreet Singh', email: 'gurpreet@farmgrid.com', phone: '9820044444', role: 'FARMER', location: 'Samrala, Punjab' },
  { id: 'usr-owner-1', name: 'Harpreet Singh (Demo Owner)', email: 'owner@farmgrid.com', phone: '9810654321', role: 'RESOURCE_OWNER', location: 'Sahnewal Machinery Depot' },
  { id: 'usr-owner-2', name: 'Malwa Agro Equipment', email: 'malwa.agro@farmgrid.com', phone: '9830022222', role: 'RESOURCE_OWNER', location: 'Ludhiana Machinery Yard' },
  { id: 'usr-biz-1', name: 'AgriLogistics Hub (Demo Business)', email: 'business@farmgrid.com', phone: '9810987654', role: 'BUSINESS', location: 'Transport Nagar, Ludhiana' },
  { id: 'usr-biz-2', name: 'SkyCrop Drone Spraying', email: 'skycrop@farmgrid.com', phone: '9840011111', role: 'BUSINESS', location: 'SkyCrop Aerial Depot' },
  { id: 'usr-admin-1', name: 'System Administrator', email: 'admin@farmgrid.com', phone: '9810000000', role: 'ADMIN', location: 'Central Operations' },
];

const SEED_FARMS: IFarmLocation[] = [
  { id: 'farm-1', farmerId: 'usr-farmer-1', farmName: "Ravi's Primary Wheat Fields", village: 'Sahnewal', district: 'Ludhiana', state: 'Punjab', fullAddress: 'Plot 12, GT Road, Sahnewal', latitude: 30.901, longitude: 75.8573, farmSize: 15, cropType: 'Wheat', isPrimary: true },
  { id: 'farm-2', farmerId: 'usr-farmer-1', farmName: "Ravi's Mustard Estate", village: 'Doraha', district: 'Ludhiana', state: 'Punjab', fullAddress: 'Canal Road, Doraha', latitude: 30.812, longitude: 75.981, farmSize: 8, cropType: 'Mustard', isPrimary: false },
  { id: 'farm-3', farmerId: 'usr-farmer-2', farmName: "Sunita's Paddy Farm", village: 'Khanna', district: 'Ludhiana', state: 'Punjab', fullAddress: 'Samrala Road, Khanna', latitude: 30.705, longitude: 76.221, farmSize: 12, cropType: 'Paddy', isPrimary: true },
  { id: 'farm-4', farmerId: 'usr-farmer-3', farmName: "Ramesh's Cotton Acres", village: 'Jagraon', district: 'Ludhiana', state: 'Punjab', fullAddress: 'Moga Highway, Jagraon', latitude: 30.785, longitude: 75.481, farmSize: 20, cropType: 'Cotton', isPrimary: true },
];

const SEED_RESOURCES: IResource[] = [
  { id: 'res-tractor-1', name: 'Mahindra 575 DI Tractor (45 HP)', type: 'Tractor', ownerId: 'usr-owner-1', location: 'Central Depot, Sahnewal', latitude: 30.92, longitude: 75.87, serviceRadius: 40, availability: 'AVAILABLE', maintenanceStatus: false, operatingHours: { start: '06:00', end: '19:00' }, pricing: { perHour: 850, currency: 'INR' }, capabilities: ['Heavy Tillage', 'Ploughing', 'Trolley Towing'] },
  { id: 'res-tractor-2', name: 'John Deere 5050D 4WD Tractor', type: 'Tractor', ownerId: 'usr-owner-2', location: 'Malwa Yard, Ludhiana', latitude: 30.91, longitude: 75.86, serviceRadius: 35, availability: 'AVAILABLE', maintenanceStatus: false, operatingHours: { start: '06:00', end: '20:00' }, pricing: { perHour: 900, currency: 'INR' }, capabilities: ['Rotavator', 'Laser Leveler', 'Heavy Duty'] },
  { id: 'res-harvester-1', name: 'Kubota DC-68G Combine Harvester', type: 'Harvester', ownerId: 'usr-owner-1', location: 'Agri Yard, Sahnewal', latitude: 30.895, longitude: 75.86, serviceRadius: 50, availability: 'AVAILABLE', maintenanceStatus: false, operatingHours: { start: '07:00', end: '18:00' }, pricing: { perHour: 2200, currency: 'INR' }, capabilities: ['Wheat Harvesting', 'Grain Separator'] },
  { id: 'res-harvester-2', name: 'Preet 987 High-Capacity Harvester', type: 'Harvester', ownerId: 'usr-owner-2', location: 'Khanna Complex', latitude: 30.71, longitude: 76.21, serviceRadius: 45, availability: 'AVAILABLE', maintenanceStatus: false, operatingHours: { start: '06:30', end: '18:30' }, pricing: { perHour: 2100, currency: 'INR' }, capabilities: ['Straw Reaper', 'Fast Discharge'] },
  { id: 'res-pump-1', name: 'Greaves 5HP Diesel Water Pump', type: 'Portable Pump', ownerId: 'usr-owner-1', location: 'Doraha Outpost', latitude: 30.83, longitude: 75.96, serviceRadius: 30, availability: 'AVAILABLE', maintenanceStatus: false, operatingHours: { start: '05:00', end: '21:00' }, pricing: { perHour: 350, currency: 'INR' }, capabilities: ['High Flow 800 LPM', 'Self-Priming'] },
  { id: 'res-drone-1', name: 'DJI Agras T40 Precision Agri Drone', type: 'Drone Spraying', ownerId: 'usr-biz-2', location: 'SkyCrop Aerial Depot', latitude: 30.908, longitude: 75.84, serviceRadius: 60, availability: 'AVAILABLE', maintenanceStatus: false, operatingHours: { start: '06:00', end: '18:30' }, pricing: { perHour: 1500, currency: 'INR' }, capabilities: ['40L Spray Tank', 'Terrain Follow', 'Centrifugal Nozzle'] },
  { id: 'res-storage-1', name: 'Solar Micro Cold Storage (10 MT)', type: 'Cold Storage', ownerId: 'usr-biz-1', location: 'Kisan Agri-Park, Ludhiana', latitude: 30.89, longitude: 75.83, serviceRadius: 50, availability: 'AVAILABLE', maintenanceStatus: false, operatingHours: { start: '00:00', end: '23:59' }, pricing: { perHour: 200, currency: 'INR' }, capabilities: ['2°C to 8°C Control', 'Humidity Regulated'] },
  { id: 'res-truck-1', name: 'Tata Ace Gold Agri Mini Truck (1.5T)', type: 'Mini Truck', ownerId: 'usr-biz-1', location: 'Transport Nagar, Ludhiana', latitude: 30.88, longitude: 75.89, serviceRadius: 50, availability: 'AVAILABLE', maintenanceStatus: false, operatingHours: { start: '06:00', end: '22:00' }, pricing: { perHour: 600, currency: 'INR' }, capabilities: ['Farm to Mandi Dispatch', 'Grain Transit'] },
];

const NOW = new Date();
const SEED_REQUESTS: IResourceRequest[] = [
  {
    id: 'req-1',
    farmerId: 'usr-farmer-1',
    farmerName: 'Ravi Kumar',
    resourceType: 'Tractor',
    requestedResource: 'res-tractor-1',
    farmLocationId: 'farm-1',
    earliestStart: new Date(NOW.getTime() + 2 * 3600000).toISOString(),
    latestEnd: new Date(NOW.getTime() + 8 * 3600000).toISOString(),
    duration: 4,
    cropType: 'Wheat',
    cropStage: 'HARVEST_READY',
    urgencyReason: 'Soil moisture optimal; crop harvest-ready. Immediate clearing required.',
    weatherRisk: 'Light Rain (12 pts)',
    latitude: 30.901,
    longitude: 75.8573,
    priorityScore: 82,
    scoreBreakdown: { urgencyScore: 21, weatherScore: 12, cropScore: 18, waitingScore: 12, logisticsScore: 8, constraintScore: 4 },
    priorityExplanation: 'Prioritized with score 82/100: harvest-ready crop (18/20), operational deadline <24 hrs (21/25), queued 8 hrs (12/15).',
    status: 'SCHEDULED',
    createdAt: new Date(NOW.getTime() - 8 * 3600000).toISOString(),
  },
  {
    id: 'req-2',
    farmerId: 'usr-farmer-2',
    farmerName: 'Sunita Devi',
    resourceType: 'Tractor',
    requestedResource: 'res-tractor-1',
    farmLocationId: 'farm-3',
    earliestStart: new Date(NOW.getTime() + 4 * 3600000).toISOString(),
    latestEnd: new Date(NOW.getTime() + 10 * 3600000).toISOString(),
    duration: 4,
    cropType: 'Paddy',
    cropStage: 'GROWING',
    urgencyReason: 'Vegetative tilling for subsequent nursery transplant.',
    weatherRisk: 'Clear (2 pts)',
    latitude: 30.705,
    longitude: 76.221,
    priorityScore: 58,
    scoreBreakdown: { urgencyScore: 11, weatherScore: 3, cropScore: 9, waitingScore: 4, logisticsScore: 6, constraintScore: 3 },
    priorityExplanation: 'Moderate priority 58/100: vegetative growth stage (9/20), flexible operational window (11/25).',
    status: 'PENDING',
    createdAt: new Date(NOW.getTime() - 2 * 3600000).toISOString(),
  },
  {
    id: 'req-3',
    farmerId: 'usr-farmer-3',
    farmerName: 'Ramesh Patel',
    resourceType: 'Harvester',
    requestedResource: 'res-harvester-1',
    farmLocationId: 'farm-4',
    earliestStart: new Date(NOW.getTime() + 24 * 3600000).toISOString(),
    latestEnd: new Date(NOW.getTime() + 30 * 3600000).toISOString(),
    duration: 4,
    cropType: 'Wheat',
    cropStage: 'PEAK_RIPENING',
    urgencyReason: 'Grain shattering imminent; requires combine harvester.',
    weatherRisk: 'Clear (3 pts)',
    latitude: 30.785,
    longitude: 75.481,
    priorityScore: 92,
    scoreBreakdown: { urgencyScore: 25, weatherScore: 3, cropScore: 20, waitingScore: 14, logisticsScore: 7, constraintScore: 5 },
    priorityExplanation: 'Emergency priority 92/100: peak ripening stage (20/20), critical deadline window (25/25).',
    status: 'SCHEDULED',
    createdAt: new Date(NOW.getTime() - 10 * 3600000).toISOString(),
  },
];

const SEED_BOOKINGS: IBooking[] = [
  {
    id: 'book-1',
    resourceId: 'res-tractor-1',
    farmerId: 'usr-farmer-1',
    requestId: 'req-1',
    startTime: new Date(NOW.getTime() + 2 * 3600000).toISOString(),
    endTime: new Date(NOW.getTime() + 6 * 3600000).toISOString(),
    travelTime: 20,
    bufferTime: 15,
    status: 'CONFIRMED',
  },
  {
    id: 'book-2',
    resourceId: 'res-harvester-1',
    farmerId: 'usr-farmer-3',
    requestId: 'req-3',
    startTime: new Date(NOW.getTime() + 24 * 3600000).toISOString(),
    endTime: new Date(NOW.getTime() + 28 * 3600000).toISOString(),
    travelTime: 30,
    bufferTime: 20,
    status: 'CONFIRMED',
  },
];

/* ==========================================================================
   4. MAIN REACT APP COMPONENT (ALL-IN-ONE)
   ========================================================================== */

export default function FarmGridApp() {
  // Global State
  const [currentUser, setCurrentUser] = useState<IUser>(SEED_USERS[0]); // Default Ravi Kumar (Farmer)
  const [users] = useState<IUser[]>(SEED_USERS);
  const [farms, setFarms] = useState<IFarmLocation[]>(SEED_FARMS);
  const [resources, setResources] = useState<IResource[]>(SEED_RESOURCES);
  const [requests, setRequests] = useState<IResourceRequest[]>(SEED_REQUESTS);
  const [bookings, setBookings] = useState<IBooking[]>(SEED_BOOKINGS);

  // Offline Architecture State
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [isSimulatedOffline, setIsSimulatedOffline] = useState<boolean>(false);
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueueItem[]>([]);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const effectiveOnline = isOnline && !isSimulatedOffline;

  // Weather Telemetry State & Simulated Alert
  const [weatherCondition, setWeatherCondition] = useState<string>('Clear');
  const [weatherTemp] = useState<number>(29);
  const [rainProb, setRainProb] = useState<number>(10);
  const [weatherAlert, setWeatherAlert] = useState<string | null>(null);
  const [weatherRiskScore, setWeatherRiskScore] = useState<number>(3);

  // Active View Tab
  const [activeTab, setActiveTab] = useState<'DASHBOARD' | 'REQUEST' | 'SCHEDULE' | 'FARMS' | 'OFFLINE' | 'SCENARIOS' | 'DISRUPTIONS'>('DASHBOARD');

  // Disruption Simulation Drawer / State
  const [showDisruptionModal, setShowDisruptionModal] = useState<boolean>(false);
  const [reallocationResult, setReallocationResult] = useState<any | null>(null);

  // Feedback Notification Banner
  const [notification, setNotification] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 4500);
  };

  // Switch Active Demo Role
  const handleSwitchRole = (role: UserRole) => {
    const target = users.find((u) => u.role === role) || users[0];
    setCurrentUser(target);
    setActiveTab('DASHBOARD');
    showToast(`Persona switched to ${target.name} (${role})`);
  };

  // Toggle Simulated Offline
  const toggleOffline = () => {
    setIsSimulatedOffline((prev) => {
      const next = !prev;
      showToast(next ? '⚡ Simulated Offline Mode Activated! Demands will be queued in IndexedDB.' : '🌐 Back Online! Auto-syncing pending offline queue...');
      return next;
    });
  };

  // Sync Offline Queue
  const handleSyncOfflineQueue = useCallback(() => {
    if (offlineQueue.length === 0) return;
    setIsSyncing(true);

    setTimeout(() => {
      const syncedRequests: IResourceRequest[] = offlineQueue.map((item) => {
        const priority = calculatePriorityScore({
          earliestStart: item.earliestStart,
          latestEnd: item.latestEnd,
          cropType: item.cropType,
          cropStage: item.cropStage,
          urgencyReason: item.urgencyReason,
          createdAt: item.createdAt,
          weatherCondition,
          weatherRiskScore,
        });

        return {
          id: `req-synced-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          farmerId: currentUser.id,
          farmerName: currentUser.name,
          resourceType: item.resourceType,
          requestedResource: item.requestedResource,
          farmLocationId: item.farmLocationId,
          earliestStart: item.earliestStart,
          latestEnd: item.latestEnd,
          duration: item.duration,
          cropType: item.cropType,
          cropStage: item.cropStage,
          urgencyReason: item.urgencyReason,
          weatherRisk: `${weatherCondition} (${weatherRiskScore} pts)`,
          latitude: item.latitude,
          longitude: item.longitude,
          priorityScore: priority.totalScore,
          scoreBreakdown: priority.scoreBreakdown,
          priorityExplanation: priority.explanation,
          status: 'PENDING',
          createdAt: item.createdAt,
          offlineCreated: true,
        };
      });

      setRequests((prev) => [...syncedRequests, ...prev]);
      setOfflineQueue([]);
      setIsSyncing(false);
      showToast(`✓ Successfully synchronized ${syncedRequests.length} offline request(s) into coordination engine!`);
    }, 1000);
  }, [offlineQueue, currentUser, weatherCondition, weatherRiskScore]);

  // Auto-sync when transitioning online
  useEffect(() => {
    if (effectiveOnline && offlineQueue.length > 0) {
      handleSyncOfflineQueue();
    }
  }, [effectiveOnline, offlineQueue.length, handleSyncOfflineQueue]);

  /* ========================================================================
     5. SCENARIOS EXECUTION ENGINE (4 CORE HACKATHON FLOWS)
     ======================================================================== */

  // Scenario 1: Conflict Detection (Ravi vs Sunita)
  const runScenario1 = () => {
    // Both request Mahindra Tractor overlapping
    const conflictResult = {
      detected: true,
      competingResources: 'Mahindra 575 DI Tractor',
      requestA: requests.find((r) => r.id === 'req-1') || requests[0],
      requestB: requests.find((r) => r.id === 'req-2') || requests[1],
      overlapMinutes: 120,
      winner: 'Farmer Ravi Kumar (Harvest Ready Wheat - 82 PTS)',
      alternativeOffer: 'Farmer Sunita Devi (Growing Paddy - 58 PTS) routed to subsequent feasible window 14:00 – 18:00',
    };
    setReallocationResult({ type: 'SCENARIO_1', data: conflictResult });
    showToast('Scenario 1 executed: Conflict detected between Ravi & Sunita. Priority engine allocated Ravi.');
  };

  // Scenario 2: Weather Risk Escalation
  const runScenario2 = () => {
    setWeatherCondition('Heavy Rain & Squall');
    setWeatherRiskScore(24);
    setWeatherAlert('RED ALERT: 55mm intense monsoon precipitation expected within 6 hours');

    // Recalculate priority scores across all requests
    setRequests((prev) =>
      prev.map((r) => {
        const updated = calculatePriorityScore({
          earliestStart: r.earliestStart,
          latestEnd: r.latestEnd,
          cropType: r.cropType,
          cropStage: r.cropStage,
          urgencyReason: r.urgencyReason,
          createdAt: r.createdAt,
          weatherCondition: 'Heavy Rain',
          weatherRiskScore: 24,
        });
        return {
          ...r,
          priorityScore: updated.totalScore,
          scoreBreakdown: updated.scoreBreakdown,
          priorityExplanation: updated.explanation,
          weatherRisk: 'Heavy Rain (24 pts)',
        };
      })
    );

    setReallocationResult({
      type: 'SCENARIO_2',
      message: 'Weather risk jumped to 24/25! Harvest-ready and vulnerable crops escalated up queue rankings.',
    });
    showToast('Scenario 2 executed: Heavy rain alert triggered! All priorities re-ranked.');
  };

  // Scenario 3: Resource Breakdown & Dynamic Reallocation
  const runScenario3 = () => {
    // Kubota Harvester breaks down
    const brokenRes = resources.find((r) => r.id === 'res-harvester-1') || resources[2];
    const altRes = resources.find((r) => r.id === 'res-harvester-2') || resources[3];

    // Mark broken resource under maintenance
    setResources((prev) =>
      prev.map((r) => (r.id === brokenRes.id ? { ...r, maintenanceStatus: true, availability: 'UNDER_MAINTENANCE' } : r))
    );

    // Reallocate Ramesh's booking to Preet Harvester
    setBookings((prev) =>
      prev.map((b) =>
        b.resourceId === brokenRes.id
          ? {
              ...b,
              resourceId: altRes.id,
              disruptionReason: `Auto-reallocated to alternative ${altRes.name} due to mechanical breakdown on ${brokenRes.name}`,
            }
          : b
      )
    );

    setReallocationResult({
      type: 'SCENARIO_3',
      data: {
        brokenResource: brokenRes.name,
        alternativeResource: altRes.name,
        farmer: 'Ramesh Patel',
        reason: 'Hydraulic transmission failure during field preparation. Dynamically reallocated to nearest compatible harvester.',
      },
    });
    showToast(`Scenario 3 executed: ${brokenRes.name} flagged maintenance. Booking dynamically migrated to ${altRes.name}!`);
  };

  // Scenario 4: Offline Queue Simulation
  const runScenario4 = () => {
    setIsSimulatedOffline(true);
    const newOfflineItem: OfflineQueueItem = {
      localId: `offline-${Date.now()}`,
      resourceType: 'Portable Pump',
      farmLocationId: 'farm-1',
      earliestStart: new Date(NOW.getTime() + 4 * 3600000).toISOString(),
      latestEnd: new Date(NOW.getTime() + 18 * 3600000).toISOString(),
      duration: 3,
      cropType: 'Mustard',
      cropStage: 'GROWING',
      urgencyReason: 'Canal rotation cycle; submitted while disconnected in field.',
      latitude: 30.901,
      longitude: 75.857,
      createdAt: new Date().toISOString(),
      status: 'PENDING',
    };
    setOfflineQueue((prev) => [newOfflineItem, ...prev]);
    setReallocationResult({
      type: 'SCENARIO_4',
      item: newOfflineItem,
      message: 'Offline mode active. Demand safely buffered in local IndexedDB. Ready to auto-sync upon reconnection.',
    });
    showToast('Scenario 4 executed: Request submitted offline & stored in local queue.');
  };

  /* ========================================================================
     6. UI RENDERER HELPERS & SUBCOMPONENTS
     ======================================================================== */

  const activeBookingsCount = bookings.filter((b) => b.status === 'CONFIRMED' || b.status === 'IN_PROGRESS').length;
  const pendingRequestsCount = requests.filter((r) => r.status === 'PENDING').length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col selection:bg-emerald-500 selection:text-white font-sans">
      {/* ----------------- TOP NAVBAR ----------------- */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 lg:px-8 py-3 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          {/* Brand Logo & Tagline */}
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setActiveTab('DASHBOARD')}>
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-600 to-green-700 flex items-center justify-center text-white shadow-md shadow-emerald-600/30">
              <Tractor className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-xl tracking-tight text-slate-900">
                  FARM<span className="text-emerald-600">GRID</span>
                </span>
                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                  PRODUCTION MVP
                </span>
              </div>
              <p className="hidden md:block text-[11px] font-medium text-slate-500">
                Smart Coordination for Shared Agricultural Resources
              </p>
            </div>
          </div>

          {/* Right Status Controls */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Offline/Online Status Pill & Toggle */}
            <button
              onClick={toggleOffline}
              title="Click to toggle simulated offline/online state"
              className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl border transition-all ${
                effectiveOnline
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                  : 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100 animate-pulse'
              }`}
            >
              {effectiveOnline ? <Wifi className="w-3.5 h-3.5 text-emerald-600" /> : <WifiOff className="w-3.5 h-3.5 text-amber-600" />}
              <span>{effectiveOnline ? 'Online' : 'Offline Mode'}</span>
              {isSimulatedOffline && <span className="text-[10px] opacity-75">(Simulated)</span>}
            </button>

            {/* Offline Queue Badge and Sync Trigger */}
            {offlineQueue.length > 0 && (
              <button
                onClick={handleSyncOfflineQueue}
                disabled={!effectiveOnline || isSyncing}
                className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-all disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{offlineQueue.length} Queued</span>
                {effectiveOnline && <span className="text-[10px] underline">Sync Now</span>}
              </button>
            )}

            {/* Quick 1-Click Role Switcher */}
            <div className="relative group">
              <button className="flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 transition-colors border border-slate-200">
                <UserCheck className="w-4 h-4 text-emerald-600" />
                <span className="hidden sm:inline">Role:</span>
                <span className="text-emerald-700">{currentUser.role}</span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>

              <div className="absolute right-0 mt-1 w-56 bg-white rounded-2xl shadow-xl border border-slate-200 py-2 hidden group-hover:block z-50 animate-in fade-in zoom-in-95">
                <div className="px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                  Switch Active Persona
                </div>
                <button
                  onClick={() => handleSwitchRole('FARMER')}
                  className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-800 flex items-center justify-between"
                >
                  <span>👨‍🌾 Ravi Kumar (Farmer)</span>
                  {currentUser.role === 'FARMER' && <span className="text-[10px] font-bold text-emerald-600">Active</span>}
                </button>
                <button
                  onClick={() => handleSwitchRole('RESOURCE_OWNER')}
                  className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-800 flex items-center justify-between"
                >
                  <span>🚜 Harpreet (Resource Owner)</span>
                  {currentUser.role === 'RESOURCE_OWNER' && <span className="text-[10px] font-bold text-emerald-600">Active</span>}
                </button>
                <button
                  onClick={() => handleSwitchRole('BUSINESS')}
                  className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-800 flex items-center justify-between"
                >
                  <span>💼 AgriLogistics (Business)</span>
                  {currentUser.role === 'BUSINESS' && <span className="text-[10px] font-bold text-emerald-600">Active</span>}
                </button>
                <button
                  onClick={() => handleSwitchRole('ADMIN')}
                  className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-800 flex items-center justify-between"
                >
                  <span>⚡ Administrator (Master Scheduler)</span>
                  {currentUser.role === 'ADMIN' && <span className="text-[10px] font-bold text-emerald-600">Active</span>}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Global Toast Notification */}
        {notification && (
          <div className="mt-2 text-center py-1 text-xs font-bold bg-emerald-100 text-emerald-900 rounded-lg border border-emerald-300 animate-in fade-in">
            {notification}
          </div>
        )}
      </header>

      {/* ----------------- MAIN LAYOUT ----------------- */}
      <div className="flex-1 max-w-7xl w-full mx-auto flex">
        {/* Navigation Sidebar */}
        <aside className="w-64 bg-white border-r border-slate-200 p-4 space-y-6 hidden md:block shrink-0 min-h-[calc(100vh-65px)]">
          {/* Quick Scenario Hub Launcher */}
          <div
            onClick={() => setActiveTab('SCENARIOS')}
            className="p-3.5 rounded-2xl bg-gradient-to-r from-amber-500/10 via-emerald-500/10 to-teal-500/10 border border-emerald-200 hover:border-emerald-300 cursor-pointer transition-all flex items-center justify-between group"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-600 group-hover:scale-110 transition-transform" />
              <span className="text-xs font-bold text-slate-900">Demo Scenarios</span>
            </div>
            <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-emerald-600 text-white">
              4 Flows
            </span>
          </div>

          {/* Navigation Links */}
          <div className="space-y-1 text-xs font-bold">
            <div className="px-3 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-2">
              Navigation Menu
            </div>
            <button
              onClick={() => setActiveTab('DASHBOARD')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
                activeTab === 'DASHBOARD' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Sliders className="w-4 h-4" />
              <span>Portal Dashboard</span>
            </button>

            {currentUser.role === 'FARMER' && (
              <>
                <button
                  onClick={() => setActiveTab('REQUEST')}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
                    activeTab === 'REQUEST' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>Request Resource</span>
                </button>
                <button
                  onClick={() => setActiveTab('FARMS')}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
                    activeTab === 'FARMS' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <MapPin className="w-4 h-4" />
                  <span>Farm Locations (GPS)</span>
                </button>
                <button
                  onClick={() => setActiveTab('OFFLINE')}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
                    activeTab === 'OFFLINE' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <WifiOff className="w-4 h-4" />
                  <span>Offline Queue ({offlineQueue.length})</span>
                </button>
              </>
            )}

            <button
              onClick={() => setActiveTab('SCHEDULE')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
                activeTab === 'SCHEDULE' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Calendar className="w-4 h-4" />
              <span>Master Schedule</span>
            </button>

            <button
              onClick={() => setShowDisruptionModal(true)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-rose-700 bg-rose-50 hover:bg-rose-100 transition-all"
            >
              <ShieldAlert className="w-4 h-4" />
              <span>Disruption Simulation Lab</span>
            </button>
          </div>

          {/* Engine Status Footnote */}
          <div className="pt-6 border-t border-slate-100 text-[11px] text-slate-500 space-y-1">
            <div className="flex items-center justify-between font-bold text-slate-700">
              <span>Coordination Engine</span>
              <span className="text-emerald-600 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" /> Active
              </span>
            </div>
            <div>Scoring: 0–100 Deterministic</div>
            <div>Scheduler: Conflict Guarded</div>
          </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 p-4 lg:p-8 overflow-y-auto min-w-0 space-y-6">
          {/* ========================================================
              TAB 1: PORTAL DASHBOARD (ROLE-TAILORED)
              ======================================================== */}
          {activeTab === 'DASHBOARD' && (
            <div className="space-y-6">
              {/* Persona Greeting Card */}
              <div className="p-6 md:p-8 rounded-3xl bg-gradient-to-r from-emerald-900 via-slate-900 to-teal-950 text-white shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold border border-emerald-500/30">
                    <span>Active Profile: {currentUser.role}</span>
                  </div>
                  <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">
                    {currentUser.name}
                  </h2>
                  <p className="text-xs md:text-sm text-slate-300 max-w-xl leading-relaxed">
                    FarmGrid is coordinating scarce agricultural machinery, irrigation pumps, and harvest transit
                    using deterministic 0–100 priority algorithms, real-time overlap prevention, and disruption auto-reallocation.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2.5">
                  {currentUser.role === 'FARMER' && (
                    <button
                      onClick={() => setActiveTab('REQUEST')}
                      className="px-5 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs shadow-md transition-all flex items-center gap-2"
                    >
                      <PlusCircle className="w-4 h-4" />
                      <span>Request Resource</span>
                    </button>
                  )}
                  <button
                    onClick={() => setActiveTab('SCENARIOS')}
                    className="px-4 py-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-extrabold text-xs border border-white/20 transition-all flex items-center gap-2"
                  >
                    <Sparkles className="w-4 h-4 text-amber-300" />
                    <span>Run Hackathon Scenarios</span>
                  </button>
                </div>
              </div>

              {/* KPI Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm">
                  <div className="text-xs font-semibold text-slate-500 mb-1">Active Allocations</div>
                  <div className="text-2xl font-extrabold text-emerald-600">{activeBookingsCount}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Non-overlapping slots</div>
                </div>

                <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm">
                  <div className="text-xs font-semibold text-slate-500 mb-1">Pending Demands</div>
                  <div className="text-2xl font-extrabold text-amber-600">{pendingRequestsCount}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Ranked in queue</div>
                </div>

                <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm">
                  <div className="text-xs font-semibold text-slate-500 mb-1">Fleet Capacity</div>
                  <div className="text-2xl font-extrabold text-slate-900">{resources.length}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {resources.filter((r) => !r.maintenanceStatus && r.availability === 'AVAILABLE').length} ready to dispatch
                  </div>
                </div>

                <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm">
                  <div className="text-xs font-semibold text-slate-500 mb-1">Weather Risk Level</div>
                  <div className="text-2xl font-extrabold text-blue-600">{weatherRiskScore}/25</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{weatherCondition}</div>
                </div>
              </div>

              {/* Weather Station & Quick Simulation Controls */}
              <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <CloudRain className="w-5 h-5 text-blue-600" />
                    <div>
                      <h3 className="text-sm font-extrabold text-slate-900">
                        Agri-Meteorological Risk Station
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        Regional conditions directly modulate the 0–100 Priority Engine.
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-800 border border-blue-200">
                    Telemetry: {weatherTemp}°C • {weatherCondition} ({rainProb}% Rain Prob)
                  </span>
                </div>

                {weatherAlert && (
                  <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-xs font-bold text-amber-900 flex items-center gap-2 animate-pulse">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>{weatherAlert}</span>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 text-xs font-bold">
                  <button
                    onClick={() => {
                      setWeatherCondition('Heavy Rain');
                      setWeatherRiskScore(22);
                      setRainProb(90);
                      setWeatherAlert('Heavy rain squall alert (45mm). High field waterlogging risk.');
                      showToast('Weather updated to Heavy Rain (Risk: 22/25)');
                    }}
                    className="px-3 py-1.5 rounded-xl bg-blue-100 hover:bg-blue-200 text-blue-800 border border-blue-200"
                  >
                    🌧️ Simulate Heavy Rain
                  </button>
                  <button
                    onClick={() => {
                      setWeatherCondition('Hailstorm');
                      setWeatherRiskScore(25);
                      setRainProb(95);
                      setWeatherAlert('EMERGENCY: Severe hailstorm warning with imminent crop destruction risk.');
                      showToast('Weather updated to Hailstorm (Risk: 25/25)');
                    }}
                    className="px-3 py-1.5 rounded-xl bg-purple-100 hover:bg-purple-200 text-purple-800 border border-purple-200"
                  >
                    🧊 Simulate Hail Warning
                  </button>
                  <button
                    onClick={() => {
                      setWeatherCondition('Clear');
                      setWeatherRiskScore(2);
                      setRainProb(10);
                      setWeatherAlert(null);
                      showToast('Weather reset to Clear & Stable');
                    }}
                    className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200"
                  >
                    ☀️ Reset to Clear
                  </button>
                </div>
              </div>

              {/* Priority Demand Queue with 0-100 Score Breakdown */}
              <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-900">
                      Demand Priority Queue & Transparent Scoring
                    </h3>
                    <p className="text-xs text-slate-500">
                      Ranks competing demands based on urgency, weather risk, crop biological stage, wait time, and proximity.
                    </p>
                  </div>
                </div>

                <div className="divide-y divide-slate-100">
                  {requests.map((req, idx) => (
                    <div key={req.id} className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs">
                      <div className="space-y-1 max-w-xl">
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-slate-400">#{idx + 1}</span>
                          <span className="font-extrabold text-slate-900 text-sm">{req.resourceType}</span>
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                            {req.cropType} ({req.cropStage})
                          </span>
                          <span
                            className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                              req.status === 'SCHEDULED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {req.status}
                          </span>
                        </div>
                        <div className="text-slate-500 text-[11px]">
                          Farmer: <strong>{req.farmerName}</strong> • Duration: {req.duration} hrs • Window:{' '}
                          {new Date(req.earliestStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} –{' '}
                          {new Date(req.latestEnd).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <p className="text-slate-600 italic text-[11px]">"{req.priorityExplanation}"</p>
                      </div>

                      <div className="shrink-0 flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-lg font-extrabold text-emerald-700">{req.priorityScore}/100</div>
                          <div className="text-[10px] text-slate-400 font-bold">Priority Score</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ========================================================
              TAB 2: RESOURCE REQUEST CREATION WIZARD
              ======================================================== */}
          {activeTab === 'REQUEST' && (
            <div className="max-w-3xl mx-auto space-y-6">
              <div>
                <h2 className="text-xl font-extrabold text-slate-900">Create Agricultural Resource Request</h2>
                <p className="text-xs text-slate-500">
                  Submit scarce machinery or irrigation requests. If offline, the request is committed to your local
                  IndexedDB queue and synchronizes upon reconnection.
                </p>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const resType = (form.elements.namedItem('resType') as HTMLSelectElement).value;
                  const farmId = (form.elements.namedItem('farmId') as HTMLSelectElement).value;
                  const cType = (form.elements.namedItem('cType') as HTMLInputElement).value;
                  const cStage = (form.elements.namedItem('cStage') as HTMLSelectElement).value as CropStage;
                  const dur = Number((form.elements.namedItem('dur') as HTMLInputElement).value);
                  const reason = (form.elements.namedItem('reason') as HTMLTextAreaElement).value;

                  const targetFarm = farms.find((f) => f.id === farmId) || farms[0];

                  if (!effectiveOnline) {
                    // Save to offline queue
                    const offlineItem: OfflineQueueItem = {
                      localId: `offline-${Date.now()}`,
                      resourceType: resType,
                      farmLocationId: farmId,
                      earliestStart: new Date(NOW.getTime() + 2 * 3600000).toISOString(),
                      latestEnd: new Date(NOW.getTime() + 12 * 3600000).toISOString(),
                      duration: dur,
                      cropType: cType,
                      cropStage: cStage,
                      urgencyReason: reason,
                      latitude: targetFarm.latitude,
                      longitude: targetFarm.longitude,
                      createdAt: new Date().toISOString(),
                      status: 'PENDING',
                    };
                    setOfflineQueue((prev) => [offlineItem, ...prev]);
                    showToast('Offline Mode: Request saved to local IndexedDB queue!');
                    setActiveTab('OFFLINE');
                    return;
                  }

                  // Online priority calculation
                  const priority = calculatePriorityScore({
                    earliestStart: new Date(NOW.getTime() + 2 * 3600000).toISOString(),
                    latestEnd: new Date(NOW.getTime() + 12 * 3600000).toISOString(),
                    cropType: cType,
                    cropStage: cStage,
                    urgencyReason: reason,
                    createdAt: new Date().toISOString(),
                    weatherCondition,
                    weatherRiskScore,
                  });

                  const newReq: IResourceRequest = {
                    id: `req-${Date.now()}`,
                    farmerId: currentUser.id,
                    farmerName: currentUser.name,
                    resourceType: resType,
                    farmLocationId: farmId,
                    earliestStart: new Date(NOW.getTime() + 2 * 3600000).toISOString(),
                    latestEnd: new Date(NOW.getTime() + 12 * 3600000).toISOString(),
                    duration: dur,
                    cropType: cType,
                    cropStage: cStage,
                    urgencyReason: reason,
                    weatherRisk: `${weatherCondition} (${weatherRiskScore} pts)`,
                    latitude: targetFarm.latitude,
                    longitude: targetFarm.longitude,
                    priorityScore: priority.totalScore,
                    scoreBreakdown: priority.scoreBreakdown,
                    priorityExplanation: priority.explanation,
                    status: 'PENDING',
                    createdAt: new Date().toISOString(),
                  };

                  setRequests((prev) => [newReq, ...prev]);
                  showToast(`Demand created! Priority Score calculated: ${priority.totalScore}/100`);
                  setActiveTab('DASHBOARD');
                }}
                className="bg-white rounded-3xl p-6 md:p-8 border border-slate-200 shadow-sm space-y-5 text-xs"
              >
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Resource Category:</label>
                  <select name="resType" className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-semibold">
                    <option value="Tractor">Tractor Fleet</option>
                    <option value="Harvester">Combine Harvester</option>
                    <option value="Portable Pump">Portable Water Pump</option>
                    <option value="Drone Spraying">Drone Spraying Service</option>
                    <option value="Cold Storage">Cold Storage Chamber</option>
                    <option value="Mini Truck">Agricultural Transit Truck</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Destination Farm Plot:</label>
                  <select name="farmId" className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-semibold">
                    {farms.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.farmName} ({f.village}) {f.isPrimary ? '★ Primary' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Crop Type:</label>
                    <input name="cType" defaultValue="Wheat" className="w-full px-3 py-2 rounded-xl border border-slate-200 font-semibold" />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Crop Stage (Biological Priority):</label>
                    <select name="cStage" defaultValue="HARVEST_READY" className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-semibold">
                      <option value="PEAK_RIPENING">Peak Ripening (Max Urgency - 20 pts)</option>
                      <option value="HARVEST_READY">Harvest Ready (18 pts)</option>
                      <option value="FLOWERING">Flowering / Sensitive (14 pts)</option>
                      <option value="GROWING">Active Growth (9 pts)</option>
                      <option value="EARLY_VEGETATIVE">Early Vegetative (4 pts)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Required Operating Duration (Hours):</label>
                  <input name="dur" type="number" defaultValue="4" min="1" max="24" className="w-full px-3 py-2 rounded-xl border border-slate-200 font-semibold" />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Urgency Justification:</label>
                  <textarea name="reason" defaultValue="Harvest window closing; impending weather risks." rows={2} className="w-full px-3 py-2 rounded-xl border border-slate-200 font-medium" />
                </div>

                <button
                  type="submit"
                  className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold transition-all shadow-md flex items-center justify-center gap-2 text-xs"
                >
                  <Sparkles className="w-4 h-4 text-emerald-200" />
                  <span>{effectiveOnline ? 'Calculate Priority & Schedule' : 'Save to Offline Queue'}</span>
                </button>
              </form>
            </div>
          )}

          {/* ========================================================
              TAB 3: MASTER SCHEDULE TIMELINE (MULTI-RESOURCE)
              ======================================================== */}
          {activeTab === 'SCHEDULE' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-extrabold text-slate-900">Master Schedule Timeline</h2>
                <p className="text-xs text-slate-500">
                  Visual inspection of allocations across machinery assets, travel transit buffers, and maintenance flags.
                </p>
              </div>

              <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm divide-y divide-slate-100">
                {resources.map((res) => {
                  const resBookings = bookings.filter((b) => b.resourceId === res.id);
                  return (
                    <div key={res.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs">
                      <div className="md:w-60 shrink-0">
                        <div className="flex items-center gap-2">
                          <Tractor className="w-4 h-4 text-emerald-600" />
                          <span className="font-extrabold text-slate-900">{res.name}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {res.type} • 📍 {res.location}
                        </div>
                        {res.maintenanceStatus && (
                          <span className="inline-block mt-1 text-[10px] font-extrabold px-2 py-0.5 rounded bg-rose-100 text-rose-800">
                            Under Maintenance
                          </span>
                        )}
                      </div>

                      <div className="flex-1 flex flex-wrap gap-2">
                        {resBookings.length === 0 ? (
                          <span className="text-slate-400 italic">No bookings — 100% available</span>
                        ) : (
                          resBookings.map((b) => (
                            <div
                              key={b.id}
                              className={`p-2.5 rounded-xl border font-semibold ${
                                b.status === 'CONFIRMED'
                                  ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                                  : 'bg-rose-50 border-rose-300 text-rose-950'
                              }`}
                            >
                              <div>
                                {new Date(b.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} –{' '}
                                {new Date(b.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} [{b.status}]
                              </div>
                              <div className="text-[10px] text-slate-500 mt-0.5">
                                +{b.travelTime}m travel +{b.bufferTime}m safety buffer
                              </div>
                              {b.disruptionReason && (
                                <div className="text-[10px] text-rose-700 font-bold mt-0.5">{b.disruptionReason}</div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ========================================================
              TAB 4: FARM LOCATIONS & GPS
              ======================================================== */}
          {activeTab === 'FARMS' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-extrabold text-slate-900">Farm Locations & Geolocation</h2>
                <p className="text-xs text-slate-500">
                  Manage agricultural plots. Changing farm coordinates triggers automatic weather, distance, and priority recalculations.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {farms.map((f) => (
                  <div key={f.id} className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-3 text-xs">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-extrabold text-sm text-slate-900">{f.farmName}</h4>
                        <p className="text-slate-500">{f.village}, {f.district}, {f.state}</p>
                      </div>
                      {f.isPrimary && (
                        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                          Primary Plot
                        </span>
                      )}
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl space-y-1">
                      <div>GPS: {f.latitude.toFixed(4)}, {f.longitude.toFixed(4)}</div>
                      <div>Plot Size: {f.farmSize} Acres • Standing Crop: {f.cropType}</div>
                    </div>

                    <button
                      onClick={() => {
                        // Simulate location change event
                        showToast(`Location Changed: FarmGrid updated weather, distance, travel time, priority, and scheduling for ${f.farmName}`);
                      }}
                      className="w-full py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition-colors"
                    >
                      Trigger Location Recalculation Event
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ========================================================
              TAB 5: OFFLINE QUEUE MANAGER
              ======================================================== */}
          {activeTab === 'OFFLINE' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-extrabold text-slate-900">Local Offline Queue</h2>
                  <p className="text-xs text-slate-500">
                    Requests submitted while disconnected are safely buffered in browser IndexedDB.
                  </p>
                </div>
                <button
                  onClick={handleSyncOfflineQueue}
                  disabled={!effectiveOnline || isSyncing || offlineQueue.length === 0}
                  className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-extrabold text-xs shadow-md disabled:opacity-50 flex items-center gap-2"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  <span>Sync Queue Now</span>
                </button>
              </div>

              {offlineQueue.length === 0 ? (
                <div className="p-12 text-center bg-white rounded-3xl border border-slate-200 text-xs text-slate-400 space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                  <div className="font-bold text-slate-700">Offline queue is currently empty</div>
                  <p className="text-[11px] text-slate-400">
                    Toggle "Offline Mode" in the top navbar to simulate submitting requests without an internet connection.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {offlineQueue.map((item) => (
                    <div key={item.localId} className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm text-xs flex justify-between items-center">
                      <div>
                        <div className="font-extrabold text-slate-900">{item.resourceType} ({item.cropType})</div>
                        <div className="text-slate-500 text-[11px]">ID: {item.localId} • Status: {item.status}</div>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                        Awaiting Reconnection
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ========================================================
              TAB 6: HACKATHON DEMO SCENARIOS HUB
              ======================================================== */}
          {activeTab === 'SCENARIOS' && (
            <div className="space-y-6">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold mb-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Demo-Ready Verification Suite</span>
                </div>
                <h2 className="text-2xl font-extrabold text-slate-900">
                  Core Agricultural Coordination Scenarios
                </h2>
                <p className="text-xs text-slate-500">
                  Execute each end-to-end hackathon requirement with 1-click verification and transparent Before vs After diffs.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* SCENARIO 1 CARD */}
                <div className="p-6 rounded-3xl bg-white border-2 border-slate-200 hover:border-amber-400 transition-all shadow-sm space-y-4 flex flex-col justify-between">
                  <div className="space-y-2">
                    <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900">
                      SCENARIO 1
                    </span>
                    <h3 className="font-extrabold text-base text-slate-900">
                      Conflict Detection & Overlap Prevention
                    </h3>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Two farmers (Ravi & Sunita) request the same Mahindra Tractor during overlapping morning hours.
                      System detects overlap, runs 0–100 priority engine, allocates Ravi, and prevents double-booking.
                    </p>
                  </div>
                  <button
                    onClick={runScenario1}
                    className="w-full py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs flex items-center justify-center gap-2 shadow-md shadow-amber-600/20"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Execute Conflict Detection Flow</span>
                  </button>
                </div>

                {/* SCENARIO 2 CARD */}
                <div className="p-6 rounded-3xl bg-white border-2 border-slate-200 hover:border-blue-400 transition-all shadow-sm space-y-4 flex flex-col justify-between">
                  <div className="space-y-2">
                    <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-900">
                      SCENARIO 2
                    </span>
                    <h3 className="font-extrabold text-base text-slate-900">
                      Weather Risk Escalation & Re-Ranking
                    </h3>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Monsoon squall alert triggered. System automatically increases weather risk score to 24/25,
                      recalculating priorities and boosting harvest-ready wheat over non-urgent vegetative crops.
                    </p>
                  </div>
                  <button
                    onClick={runScenario2}
                    className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs flex items-center justify-center gap-2 shadow-md shadow-blue-600/20"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Execute Weather Re-Ranking Flow</span>
                  </button>
                </div>

                {/* SCENARIO 3 CARD */}
                <div className="p-6 rounded-3xl bg-white border-2 border-slate-200 hover:border-rose-400 transition-all shadow-sm space-y-4 flex flex-col justify-between">
                  <div className="space-y-2">
                    <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-900">
                      SCENARIO 3
                    </span>
                    <h3 className="font-extrabold text-base text-slate-900">
                      Resource Breakdown & Reallocation
                    </h3>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Kubota Harvester suffers mechanical breakdown. Marked under maintenance. Reallocation Engine
                      discovers the alternative Preet Harvester and transparently migrates the scheduled booking.
                    </p>
                  </div>
                  <button
                    onClick={runScenario3}
                    className="w-full py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs flex items-center justify-center gap-2 shadow-md shadow-rose-600/20"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Execute Breakdown Reallocation Flow</span>
                  </button>
                </div>

                {/* SCENARIO 4 CARD */}
                <div className="p-6 rounded-3xl bg-white border-2 border-slate-200 hover:border-emerald-400 transition-all shadow-sm space-y-4 flex flex-col justify-between">
                  <div className="space-y-2">
                    <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900">
                      SCENARIO 4
                    </span>
                    <h3 className="font-extrabold text-base text-slate-900">
                      Offline-First Queue & Synchronization
                    </h3>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Simulate a farmer submitting a request while offline. Request is committed locally to IndexedDB,
                      displaying a pending sync state, and auto-syncs when online connectivity returns.
                    </p>
                  </div>
                  <button
                    onClick={runScenario4}
                    className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Execute Offline Sync Flow</span>
                  </button>
                </div>
              </div>

              {/* Scenario Execution Result Drawer */}
              {reallocationResult && (
                <div className="p-6 rounded-3xl bg-white border-2 border-emerald-500 shadow-xl space-y-3 animate-in fade-in text-xs">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100 font-extrabold text-sm text-slate-900">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                      Algorithmic Execution Result
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                      Verified
                    </span>
                  </div>

                  {reallocationResult.type === 'SCENARIO_1' && (
                    <div className="space-y-2">
                      <div className="p-3 bg-amber-50 rounded-xl font-bold text-amber-950">
                        Collision: 2 Demands for {reallocationResult.data.competingResources} (Overlap: {reallocationResult.data.overlapMinutes} mins)
                      </div>
                      <div className="p-3 bg-emerald-50 rounded-xl text-emerald-900">
                        <div><strong>Allocation Winner:</strong> {reallocationResult.data.winner}</div>
                        <div className="mt-1"><strong>Alternative:</strong> {reallocationResult.data.alternativeOffer}</div>
                      </div>
                    </div>
                  )}

                  {reallocationResult.type === 'SCENARIO_2' && (
                    <div className="p-4 bg-blue-50 rounded-xl text-blue-900 font-medium">
                      {reallocationResult.message}
                    </div>
                  )}

                  {reallocationResult.type === 'SCENARIO_3' && (
                    <div className="p-4 bg-rose-50 rounded-xl text-rose-900 space-y-1">
                      <div><strong>Disrupted:</strong> {reallocationResult.data.brokenResource} (Marked UNDER_MAINTENANCE)</div>
                      <div><strong>Reallocated To:</strong> {reallocationResult.data.alternativeResource} for {reallocationResult.data.farmer}</div>
                      <div className="text-[11px] text-slate-600 italic">"{reallocationResult.data.reason}"</div>
                    </div>
                  )}

                  {reallocationResult.type === 'SCENARIO_4' && (
                    <div className="p-4 bg-emerald-50 rounded-xl text-emerald-900 space-y-1">
                      <div><strong>IndexedDB Cached ID:</strong> {reallocationResult.item.localId}</div>
                      <div>{reallocationResult.message}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* ----------------- DISRUPTION SIMULATION MODAL ----------------- */}
      {showDisruptionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 md:p-8 space-y-6 shadow-2xl border border-slate-200 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2 font-extrabold text-base text-slate-900">
                <ShieldAlert className="w-5 h-5 text-rose-600" />
                <span>Disruption Simulation Lab</span>
              </div>
              <button onClick={() => setShowDisruptionModal(false)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>

            <p className="text-slate-500">
              Trigger instant real-time shocks and observe algorithmic schedule recovery and Before/After reallocations.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  runScenario3();
                  setShowDisruptionModal(false);
                }}
                className="p-4 rounded-2xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-left space-y-1 transition-all"
              >
                <div className="font-extrabold text-rose-900">Simulate Breakdown</div>
                <div className="text-[10px] text-rose-700">Marks unit maintenance & reallocates</div>
              </button>

              <button
                onClick={() => {
                  runScenario2();
                  setShowDisruptionModal(false);
                }}
                className="p-4 rounded-2xl bg-blue-50 hover:bg-blue-100 border border-blue-200 text-left space-y-1 transition-all"
              >
                <div className="font-extrabold text-blue-900">Simulate Rain Alert</div>
                <div className="text-[10px] text-blue-700">Elevates weather risk score to 24</div>
              </button>
            </div>

            <div className="text-right pt-2">
              <button
                onClick={() => setShowDisruptionModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200"
              >
                Close Lab
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
