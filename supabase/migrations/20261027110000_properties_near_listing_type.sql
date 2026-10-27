-- properties_near(): also return listing_type so callers can tell monthly rents from sale prices.
-- The return type changes, so the function is dropped and recreated (same signature and grants).
drop function public.properties_near(double precision, double precision, double precision);

create function public.properties_near(lat double precision, lng double precision, radius_km double precision)
returns table (id uuid, slug text, city text, listing_type text, price_eur integer, distance_km double precision)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.slug, p.city, p.listing_type, p.price_eur,
         extensions.st_distance(p.geom, extensions.st_point(lng, lat, 4326)::extensions.geography) / 1000.0
  from public.properties p
  where p.status = 'active'
    and radius_km > 0 and radius_km <= 200
    and extensions.st_dwithin(p.geom, extensions.st_point(lng, lat, 4326)::extensions.geography, radius_km * 1000)
  order by 6
  limit 50
$$;

revoke all on function public.properties_near(double precision, double precision, double precision) from public;
grant execute on function public.properties_near(double precision, double precision, double precision) to anon, authenticated;
