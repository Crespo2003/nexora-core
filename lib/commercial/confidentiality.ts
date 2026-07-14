import type { CommercialListing, CommercialRole } from './types';

export function maskContact(value: string) {
  if (!value) return '';
  if (value.includes('@')) { const [name, domain] = value.split('@'); return `${name.slice(0, 1)}***@${domain}`; }
  const clean = value.replace(/\s/g, '');
  return clean.length <= 4 ? '****' : `${'*'.repeat(Math.max(clean.length - 4, 4))}${clean.slice(-4)}`;
}

export function filterListingForRole(listing: CommercialListing, role: CommercialRole, userId: string) {
  const privileged = ['owner', 'admin', 'manager'].includes(role) || (role === 'agent' && listing.assignedUserId === userId);
  if (privileged || listing.confidentialityLevel === 'normal') return listing;
  const highlyRestricted = listing.confidentialityLevel === 'highly_confidential';
  return {
    ...listing,
    propertyName: highlyRestricted ? '' : listing.propertyName,
    address: listing.concealedAddress || listing.area || listing.city || '',
    landlordName: '', landlordContact: '', photoPaths: [], documentPaths: [], notes: '',
    askingRental: highlyRestricted && role === 'viewer' ? approximate(listing.askingRental) : listing.askingRental,
    askingSalePrice: highlyRestricted && role === 'viewer' ? approximate(listing.askingSalePrice) : listing.askingSalePrice,
    builtUp: highlyRestricted ? approximate(listing.builtUp, 100) : listing.builtUp
  };
}

export function canAccessSensitiveListing(role: CommercialRole, listing: CommercialListing, userId: string) {
  return ['owner', 'admin', 'manager'].includes(role) || (role === 'agent' && listing.assignedUserId === userId);
}

function approximate(value?: number | null, step = 1000) { return value == null ? value : Math.round(value / step) * step; }

