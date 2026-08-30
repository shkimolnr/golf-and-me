drop index if exists public.club_distance_user_set_club_uidx;
drop index if exists public.user_clubs_user_client_id_uidx;

-- 두 번째 마이그레이션부터는 거리 미입력 클럽도 세트 구성원으로
-- 보존하므로, 초기 스키마로 되돌릴 때만 해당 빈 행을 제거한다.
delete from public.club_distance_history where distance is null;

alter table public.club_distance_history
  drop constraint if exists club_distance_history_distance_basis_check,
  drop column if exists is_changed,
  drop column if exists club_snapshot,
  drop column if exists normalized_distance_m,
  drop column if exists distance_basis,
  drop column if exists set_id;

alter table public.club_distance_history
  alter column distance set not null;

alter table public.user_clubs
  drop column if exists payload,
  drop column if exists client_id;

alter table public.user_clubs
  add constraint user_clubs_user_id_name_key unique (user_id, name);
