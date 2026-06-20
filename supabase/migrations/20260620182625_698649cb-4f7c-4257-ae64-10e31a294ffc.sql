create or replace function public.message_contains_link(_body text)
returns boolean
language plpgsql
immutable
as $$
declare
  s text;
begin
  if _body is null or length(_body) = 0 then
    return false;
  end if;
  s := lower(_body);

  if s ~ '(https?://|www\.)' then
    return true;
  end if;
  if s ~ '(t\.me|bit\.ly|tinyurl|wa\.me|discord\.gg|youtu\.?be|tiktok|instagr|twitch\.tv|telegram\.me|fb\.com)' then
    return true;
  end if;

  s := regexp_replace(s, E'[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]', '', 'g');
  s := regexp_replace(s, '\(dot\)|\[dot\]|\{dot\}|\s+dot\s+|نقطه|نقطة|·|・|｡|。', '.', 'g');
  s := regexp_replace(s, E'[\\s\\-_\\*''"`~|]+', '', 'g');

  if s ~ 'https?://' then return true; end if;
  if s ~ 'www\.[a-z0-9]' then return true; end if;

  if s ~ '[a-z0-9]{2,}\.(com|net|org|io|co|me|tv|app|dev|gg|ly|xyz|info|biz|sa|ae|eg|kw|qa|om|bh|jo|sy|iq|ye|ma|tn|dz|ru|de|fr|es|it|tr|uk|us|cn|jp|kr|br|in|au|ca|nl|se|no|fi|ch|pl|to|cc|sh|is|im|fm|ws|vip|top|red|mobi|asia|online|store|shop|site|website|link|click|page|pro|tech|cloud|tube|stream|live|game|games|fun|wtf|email|chat|news|life|love|media|space|studio|today|video|wiki|work|world|zone|group|art|blog|fyi|host|icu|ink|ltd|menu|money|plus|press|run|tips|tours|town|gle|goog)([/?#:]|$|[^a-z0-9])' then
    return true;
  end if;

  if s ~ '\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}' then
    return true;
  end if;

  return false;
end;
$$;

create or replace function public.messages_block_links_trg()
returns trigger
language plpgsql
as $$
begin
  if new.body is not null and public.message_contains_link(new.body) then
    raise exception '🚫 ممنوع إرسال الروابط في الشات'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_block_links on public.messages;
create trigger messages_block_links
  before insert on public.messages
  for each row execute function public.messages_block_links_trg();