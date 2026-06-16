// enrichCharacter.js — обогащение персонажа данными
import { supabase } from './config/supabase.js';

export async function enrichCharacter(ch) {
  if (!ch) return null;

  const enrichSingle = async (char) => {
    const [{ data: prof }, { data: cp }, { data: cs }, { data: inv }] = await Promise.all([
      supabase.from('professions').select('*').eq('id', char.profession_id).single(),
      supabase.from('character_perks').select('perk_id, linked_perk_id').eq('character_id', char.id),
      supabase.from('character_skills').select('skill_id, modifier').eq('character_id', char.id),
      supabase.from('inventory_slots')
        .select('*, item:items(*, ammo_type:ammo_types(*)), children:inventory_slots(*, item:items(*, ammo_type:ammo_types(*)))')
        .eq('character_id', char.id)
        .is('parent_slot_id', null)
    ]);

    const pIds = (cp || []).map(x => x.perk_id);
    const sIds = (cs || []).map(x => x.skill_id);

    const [{ data: perks }, { data: skills }] = await Promise.all([
      pIds.length ? supabase.from('perks').select('*').in('id', pIds) : Promise.resolve({ data: [] }),
      sIds.length ? supabase.from('skills').select('*').in('id', sIds) : Promise.resolve({ data: [] }),
    ]);

    const sm = {};
    for (const p of (perks || [])) {
      for (const m of (p.effect_modifiers || [])) {
        if (m.skill) sm[m.skill] = (sm[m.skill] || 0) + (m.modifier || 0);
      }
    }

    // Адаптация
    for (const cpItem of (cp || [])) {
      if (cpItem.linked_perk_id) {
        const linkedPerk = (perks || []).find(p => p.id === cpItem.linked_perk_id);
        if (linkedPerk) {
          for (const m of (linkedPerk.effect_modifiers || [])) {
            if (m.skill) {
              if (m.modifier < 0) sm[m.skill] = (sm[m.skill] || 0) + 5;
            }
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

    const enrichedSkills = (skills || []).map(s => {
      const bm = (cs || []).find(e => e.skill_id === s.id)?.modifier || 0;
      const pb = sm[s.name] || 0;
      return {
        ...s,
        modifier: bm,
        baseModifier: bm,
        perkBonus: pb,
        totalModifier: bm + pb,
        totalPercent: bm + pb
      };
    });

    const enrichedInventory = (inv || []).map(slot => {
      const children = slot.children || [];
      let totalWeight = slot.item?.weight || 0;
      if (slot.item?.is_container && children.length > 0) {
        for (const child of children) {
          totalWeight += (child.item?.weight || 0) * (child.quantity || 1);
        }
      }
      return {
        ...slot,
        containerWeight: slot.item?.is_container ? totalWeight : null,
        children
      };
    });

    return {
      ...char,
      campaign_id: char.campaign_id,
      profession: prof || null,
      perks: perks || [],
      skills: enrichedSkills,
      inventory: enrichedInventory,
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
