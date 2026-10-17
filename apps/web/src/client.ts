import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabase = url && key ? createClient(url, key) : null;
export const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
export const facilityId = import.meta.env.VITE_FACILITY_ID ?? "demo_facility";
