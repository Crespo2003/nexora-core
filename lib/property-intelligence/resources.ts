export const propertyResources = {
  analyses: {
    table: 'property_analyses',
    fields: ['latitude','longitude','built_up_sqft','purchase_price','down_payment','estimated_market_value','estimated_monthly_rental','monthly_operating_cost','monthly_financing_cost','occupancy_rate','annual_capital_growth_rate','analysis_status','assigned_user_id']
  },
  comparables: {
    table: 'property_comparables',
    fields: ['analysis_id','comparable_type','property_name','property_address','property_type','latitude','longitude','price','rental','built_up_sqft','psf','distance_km','transaction_date','source_name','source_url','source_reference','verification_status','verified_at','notes','assigned_user_id']
  },
  nearby: {
    table: 'property_nearby_places',
    fields: ['analysis_id','category','name','latitude','longitude','distance_km','travel_time_minutes','travel_mode','source_name','source_reference','verified_at','notes','assigned_user_id']
  },
  scores: { table: 'property_scores', fields: [] }
} as const;

export type PropertyResource = keyof typeof propertyResources;

export function propertyResource(value: string) {
  return Object.prototype.hasOwnProperty.call(propertyResources, value) ? value as PropertyResource : null;
}

export function allowedPropertyChanges(resource: PropertyResource, input: Record<string, unknown>) {
  const fields = new Set<string>(propertyResources[resource].fields as readonly string[]);
  return Object.fromEntries(Object.entries(input).filter(([key]) => fields.has(key) && key !== 'workspace_id' && key !== 'created_by'));
}

