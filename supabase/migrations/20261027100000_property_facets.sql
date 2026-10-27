-- Filter options for the catalogue (regions, types), computed in the database
-- so the web never has to pull every row to build its select boxes.
-- security_invoker: the caller's RLS applies, so only active listings are counted.
create view public.property_facets
with (security_invoker = true) as
select region, property_type, listing_type, count(*)::integer as listing_count
from public.properties
where status = 'active'
group by region, property_type, listing_type;

revoke all on public.property_facets from anon, authenticated;
grant select on public.property_facets to anon, authenticated;
