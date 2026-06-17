// enrichCharacter.js — обогащение персонажа данными
import { supabase } from './config/supabase.js';

export async function enrichCharacter(ch) {
  if (!ch) return null;

  const enrichSingle = async (char) => {
    const [
      { data: prof },
      { data: cp },
      { data: cs },
      { data: inv },
      { data: statusValues }
    ] = await Promise.all([
      supabase.from('professions').select('*').eq('id', char.profession_id).single(),
      supabase.from('character_perks').select('perk_id, linked_perk_id').eq('character_id', char.id),
      supabase.from('character_skills').select('skill_id, modifier').eq('character_id', char.id),
      supabase.from('inventory_slots')
        .select('*, item:items(*, ammo_type:ammo_types(*), item_slot:item_slots(*)), children:inventory_slots(*, item:items(*, ammo_type:ammo_types(*)))')
        .eq('character_id', char.id)
        .is('parent_slot_id', null),
      supabase.from('character_status_values')
        .select('*, status:character_statuses(*)')
        .eq('character_id', char.id)
    ]);

    const pIds = (cp || []).map(x => x.perk_id);
    const sIds = (cs || []).map(x => x.skill_id);

    const [{ data: perks }, { data: skills }] = await Promise.all([
      pIds.length ? supabase.from('perks').select('*').in('id', pIds) : Promise.resolve({ data: [] }),
      sIds.length ? supabase.from('skills').select('*').in('id', sIds) : Promise.resolve({ data: [] }),
    ]);

    // Получаем все связи навыков
    let allSkillLinks = [];
    if (sIds.length) {
      const { data: links } = await supabase.from('skill_links')
        .select('*').in('child_skill_id', sIds);
      allSkillLinks = links || [];
    }

    // Строим карту бонусов от перков
    const sm = {};
    for (const p of (perks || [])) {
      for (const m of (p.effect_modifiers || [])) {
        if (m.skill) sm[m.skill] = (sm[m.skill] || 0) + (m.modifier || 0);
      }
    }

    // Адаптация: +5% к затронутым навыкам
    for (const cpItem of (cp || [])) {
      if (cpItem.linked_perk_id) {
        const linkedPerk = (perks || []).find(p => p.id === cpItem.linked_perk_id);
        if (linkedPerk) {
          for (const m of (linkedPerk.effect_modifiers || [])) {
            if (m.skill) sm[m.skill] = (sm[m.skill] || 0) + 5;
          }
        }
      }
    }

    // Грузоподъёмность
    let carryBonus = 0;
    for (const p of (perks || [])) {
      for (const m of (p.effect_modifiers || [])) {
        if (m.param === 'carry_weight_max') carryBonus += (m.modifier || 0);
      }
    }

    // Обогащаем навыки с учётом иерархии и связей
    const enrichedSkills = (skills || []).map(s => {
      const bm = (cs || []).find(e => e.skill_id === s.id)?.modifier || 0;
      const pb = sm[s.name] || 0;

      // Считаем бонус от родительских навыков
      let linkBonus = 0;
      const childLinks = allSkillLinks.filter(l => l.child_skill_id === s.id);
      for (const link of childLinks) {
        const parentSkill = (skills || []).find(sk => sk.id === link.parent_skill_id);
        if (parentSkill) {
          const parentMod = (cs || []).find(e => e.skill_id === parentSkill.id)?.modifier || 0;
          linkBonus += parentMod * (link.coefficient || 1.0);
        }
      }

      return {
        ...s,
        modifier: bm,
        baseModifier: bm,
        perkBonus: pb,
        linkBonus: Math.round(linkBonus),
        totalModifier: bm + pb + Math.round(linkBonus),
        totalPercent: bm + pb + Math.round(linkBonus)
      };
    });

    // Обогащаем инвентарь
    const enrichedInventory = (inv || []).map(slot => {
      const children = slot.children || [];
      let totalWeight = slot.item?.weight || 0;
      if (slot.item?.item_slot?.name === 'container' && children.length > 0) {
        for (const child of children) {
          totalWeight += (child.item?.weight || 0) * (child.quantity || 1);
        }
      }
      return {
        ...slot,
        containerWeight: slot.item?.item_slot?.name === 'container' ? totalWeight : null,
        children
      };
    });

    // Статусы
    const statuses = (statusValues || []).map(sv => ({
      id: sv.status?.id,
      name: sv.status?.name,
      icon: sv.status?.icon,
      value: sv.value,
      min: sv.status?.min_value || 0,
      max: sv.status?.max_value || 100
    }));

    return {
      ...char,
      campaign_id: char.campaign_id,
      profession: prof || null,
      perks: perks || [],
      skills: enrichedSkills,
      inventory: enrichedInventory,
      statuses,
      carry_weight_max: (char.carry_weight_max || 50) + carryBonus
    };
  };

  if (Array.isArray(ch)) return Promise.all(ch.map(enrichSingle));
  return enrichSingle(ch);
}

export function getWeightPenalty(percent) {
  if (percent <= 70) return { penalty: 0, label: 'Норма' };
  if (percent <= 85) return { penalty: -5, label: 'Перегруз 85%' };
  if (percent <= 95) return { penalty: -15, label: 'Перегруз 95%' };
  if (percent <= 110) return { penalty: 'disadvantage', label: 'Помеха' };
  if (percent <= 125) return { penalty: 'double_disadvantage', label: 'Двойная помеха' };
  return { penalty: 'immobile', label: 'Невозможно двигаться' };
}
