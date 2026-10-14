import type { AppData } from '../shared/types.ts';
import type { StoreLike } from './contracts.ts';
import { capacityCommand, capacityPlanRecord } from './capaplan-validation.ts';
import { capacityPlan, capacityManager, capacityPmo, domainResourceIds, demandAllocated, capacityMonthMetrics, monthlyOverhead, shiftCapacityMonth, type CapacityPlan, type CapacityDemand } from '../shared/capaplan.ts';
import { canProject, isAdmin } from '../shared/permissions.ts';

export class CapacityPlanError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function fail(status: number, message: string): never { throw new CapacityPlanError(status, message); }
export function mutateCapacityPlan(store: StoreLike, data: AppData, body: unknown): CapacityPlan {
  const parsed = capacityCommand.safeParse(body); if (!parsed.success) fail(400, parsed.error.issues.map(item => item.message).join(' '));
  const command = parsed.data, plan = structuredClone(capacityPlan(data)), at = new Date().toISOString(), nowMonth = data.today.slice(0,7);
  const id = () => crypto.randomUUID(); let targetId = '', before: unknown = null, after: unknown = null, reason = 'reason' in command ? command.reason : '';
  const resource = (resourceId: string) => data.resources.find(item => item.id === resourceId && item.active && item.type !== 'material') ?? fail(400, 'Choisissez une ressource active humaine ou virtuelle.');
  const domain = (domainId: string) => plan.domains.find(item => item.id === domainId) ?? fail(404, 'Domaine introuvable.');
  const skill = (skillId: string) => plan.skills.find(item => item.id === skillId) ?? fail(404, 'Compétence introuvable.');
  const manager = (domainId: string) => { if (!capacityManager(data, domainId, plan)) fail(403, 'Cette action est réservée au manager du domaine ou au PMO.'); };
  const resourceManager = (resourceId: string) => {
    resource(resourceId); const domains = plan.domains.filter(item => domainResourceIds(data, item).has(resourceId));
    if (!capacityPmo(data,plan) && !domains.some(item => capacityManager(data,item.id,plan))) fail(403, 'Vous ne gérez pas le domaine de cette ressource.');
  };
  const projectManager = (projectId: string) => {
    const project = data.projects.find(item => item.id === projectId) ?? fail(404,'Projet introuvable.');
    if (!capacityPmo(data,plan) && !canProject(data,projectId,'details')) fail(403, 'Cette action nécessite le rôle chef de projet ou PMO.');
    if (['paused','closed'].includes(project.status)) fail(409,'Ce projet est en lecture seule.');
  };
  const eligible = (demand: CapacityDemand, resourceId: string) => {
    const member = resource(resourceId), competency = skill(demand.skillId);
    if (!domainResourceIds(data,domain(competency.domainId)).has(resourceId) || !plan.memberships.some(item=>item.resourceId===resourceId&&item.skillId===demand.skillId)) fail(400,'La ressource doit appartenir au domaine et à la compétence de la demande.');
    if (member.classification==='external' && !plan.contracts.some(item=>item.resourceId===resourceId&&item.startMonth<=demand.month&&item.endMonth>=demand.month&&item.monthlyDays>0)) fail(400,'La capacité contractuelle de cet externe est incomplète pour ce mois.');
  };
  if (command.action === 'settings') {
    if (!capacityPmo(data,plan)) fail(403,'Paramétrage réservé au PMO.');
    if (!isAdmin(data) && JSON.stringify(command.value.pmoIds)!==JSON.stringify(plan.settings.pmoIds)) fail(403,'Seul un administrateur attribue les droits PMO.');
    for(const managerId of command.value.pmoIds) { const value=resource(managerId); if(value.type!=='human'||value.role==='visitor') fail(400,'Choisissez un membre humain avec un rôle actif pour le PMO.'); }
    targetId='settings'; before=plan.settings; plan.settings=command.value; after=plan.settings;
  } else if (command.action === 'domain') {
    if(!isAdmin(data)) fail(403,'Seul un administrateur configure les domaines.');
    const value={...command.value,id:command.value.id??id()}; if(command.value.id&&!plan.domains.some(item=>item.id===command.value.id)) fail(404,'Domaine introuvable.');
    for(const teamId of value.teamIds) if(!data.organizationUnits?.some(item=>item.id===teamId)) fail(400,'Une équipe organisationnelle est introuvable.');
    for(const resourceId of value.resourceIds) resource(resourceId);
    for(const managerId of value.managerIds) { const member=resource(managerId); if(member.type!=='human'||member.role==='visitor') fail(400,'Le manager doit être un membre humain actif.'); }
    for(const other of plan.domains.filter(item=>item.id!==value.id)) {
      if(other.teamIds.some(teamId=>value.teamIds.includes(teamId))) fail(409,`Une équipe appartient déjà au domaine ${other.name}.`);
      const others=domainResourceIds(data,other); if([...domainResourceIds(data,value)].some(resourceId=>others.has(resourceId))) fail(409,`Une ressource appartient déjà au domaine ${other.name}.`);
    }
    const newIds=domainResourceIds(data,value), skillIds=new Set(plan.skills.filter(item=>item.domainId===value.id).map(item=>item.id));
    if(plan.memberships.some(item=>skillIds.has(item.skillId)&&!newIds.has(item.resourceId))) fail(409,'Retirez d’abord les rattachements aux compétences des ressources sorties du domaine.');
    before=plan.domains.find(item=>item.id===value.id)??null; plan.domains=[...plan.domains.filter(item=>item.id!==value.id),value]; targetId=value.id;after=value;
  } else if (command.action === 'skill-request') {
    manager(command.domainId); domain(command.domainId);
    if(plan.skills.some(item=>item.domainId===command.domainId&&item.name.toLocaleLowerCase('fr')===command.name.toLocaleLowerCase('fr')&&item.status!=='rejected')) fail(409,'Cette compétence existe déjà ou est en cours de validation.');
    const value={id:id(),domainId:command.domainId,name:command.name,status:'requested' as const,reason:command.reason}; plan.skills.push(value); targetId=value.id; after=value;
  } else if (command.action === 'skill-status') {
    const previous=skill(command.id);
    if(command.status==='created') { if(!isAdmin(data)) fail(403,'Création réservée à l’administrateur après validation PMO.'); if(previous.status!=='approved') fail(409,'Le PMO doit d’abord valider la compétence.'); }
    else { if(!capacityPmo(data,plan)) fail(403,'Validation réservée au PMO.'); if(previous.status!=='requested') fail(409,'Cette demande a déjà été traitée.'); }
    if(command.status==='rejected'&&!command.reason) fail(400,'Un motif de refus est obligatoire.');
    before=previous;after={...previous,status:command.status,reason:command.reason}; plan.skills=plan.skills.map(item=>item.id===command.id?after as typeof previous:item); targetId=command.id;
  } else if (command.action === 'membership') {
    const competency=skill(command.skillId); manager(competency.domainId);resource(command.resourceId);
    if(competency.status!=='created') fail(409,'La compétence doit être créée après validation.');
    if(!domainResourceIds(data,domain(competency.domainId)).has(command.resourceId)) fail(400,'Cette ressource n’appartient pas au domaine.');
    const old=plan.memberships.find(item=>item.resourceId===command.resourceId&&item.skillId===command.skillId); before=old??null;
    if(command.remove) {
      const future=plan.allocations.filter(item=>item.resourceId===command.resourceId&&plan.demands.some(demand=>demand.id===item.demandId&&demand.skillId===command.skillId&&demand.month>=nowMonth));
      if(future.length&&!command.confirm) fail(409,`${future.length} affectation(s) future(s) utilisent cette compétence. Confirmez le retrait après consultation des affectations.`);
      plan.memberships=plan.memberships.filter(item=>item!==old); targetId=old?.id??command.resourceId;
    } else {
      const sum=plan.memberships.filter(item=>item.resourceId===command.resourceId&&item!==old).reduce((total,item)=>total+(item.share??0),0)+(command.share??0);if(sum>100+1e-9) fail(400,'La somme des parts de compétences dépasse 100 %.');
      const value={id:old?.id??id(),resourceId:command.resourceId,skillId:command.skillId,share:command.share}; plan.memberships=[...plan.memberships.filter(item=>item!==old),value];targetId=value.id;after=value;
    }
  } else if (command.action === 'contract') {
    resourceManager(command.resourceId);if(resource(command.resourceId).classification!=='external') fail(400,'Les contrats capacitaires concernent les ressources externes.');if(command.startMonth>command.endMonth) fail(400,'La fin doit suivre le début.');
    const old=plan.contracts.find(item=>item.resourceId===command.resourceId&&item.startMonth===command.startMonth&&item.endMonth===command.endMonth);
    if(plan.contracts.some(item=>item.resourceId===command.resourceId&&item!==old&&item.startMonth<=command.endMonth&&item.endMonth>=command.startMonth)) fail(409,'Une capacité contractuelle existe déjà sur cette période.');
    const value={id:old?.id??id(),resourceId:command.resourceId,monthlyDays:command.monthlyDays,startMonth:command.startMonth,endMonth:command.endMonth};before=old??null;after=value;targetId=value.id;plan.contracts=[...plan.contracts.filter(item=>item!==old),value];
  } else if (command.action === 'overhead'||command.action==='carry') {
    resourceManager(command.resourceId);if(command.month<nowMonth||command.month>shiftCapacityMonth(nowMonth,2)) fail(400,'Saisissez le hors-projet sur les trois mois glissants.');
    const old=plan.overheads.find(item=>item.resourceId===command.resourceId&&item.month===command.month);if(command.action==='carry'&&old)return plan;
    if(command.action==='carry'&&Number(data.today.slice(8,10))<plan.settings.carryDay&&command.month===nowMonth)fail(409,'La date de reconduction paramétrée n’est pas encore atteinte.');
    const prior=monthlyOverhead(plan,command.resourceId,command.month);const value={id:old?.id??id(),resourceId:command.resourceId,month:command.month,runDays:command.action==='carry'?prior.runDays:command.runDays,otherDays:command.action==='carry'?prior.otherDays:command.otherDays,source:command.action==='carry'?'carried' as const:command.source};
    before=old??null;after=value;targetId=value.id;plan.overheads=[...plan.overheads.filter(item=>item!==old),value];
  } else if (command.action==='demand') {
    const value=command.value;projectManager(value.projectId);const competency=skill(value.skillId);if(competency.status!=='created')fail(400,'Sélectionnez une compétence validée et créée.');
    const old=value.id?plan.demands.find(item=>item.id===value.id):undefined;if(value.id&&!old)fail(404,'Demande introuvable.');if(old)projectManager(old.projectId);
    if(old&&demandAllocated(plan,old.id)>0&&(old.skillId!==value.skillId||old.month!==value.month||old.projectId!==value.projectId))fail(409,'Libérez les affectations avant de requalifier la demande.');
    if(old&&demandAllocated(plan,old.id)>value.days+1e-9)fail(409,'La demande ne peut être inférieure aux jours déjà affectés.');
    const saved={...value,id:old?.id??id(),createdAt:old?.createdAt??at,updatedAt:at};before=old??null;after=saved;targetId=saved.id;plan.demands=[...plan.demands.filter(item=>item!==old),saved];
  } else if(command.action==='demand-delete') {
    const old=plan.demands.find(item=>item.id===command.id)??fail(404,'Demande introuvable.');projectManager(old.projectId);if(demandAllocated(plan,old.id)>0)fail(409,'Libérez les affectations avant de supprimer la demande.');before=old;targetId=old.id;plan.demands=plan.demands.filter(item=>item!==old);
  } else if(command.action==='allocation'||command.action==='allocation-delete'||command.action==='replace') {
    const old=command.action==='allocation'?plan.allocations.find(item=>item.demandId===command.demandId&&item.resourceId===command.resourceId):plan.allocations.find(item=>item.id===(command.action==='replace'?command.allocationId:command.id));
    if(command.action!=='allocation'&&!old)fail(404,'Affectation introuvable.');
    const demand=plan.demands.find(item=>item.id===(command.action==='allocation'?command.demandId:old!.demandId))??fail(404,'Demande introuvable.');const competency=skill(demand.skillId);manager(competency.domainId);
    const project=data.projects.find(item=>item.id===demand.projectId);if(!project||['closed','paused'].includes(project.status))fail(409,'Ce projet est en lecture seule.');
    const other=plan.allocations.filter(item=>item!==old);before=old??null;
    if(command.action==='allocation-delete'){targetId=old!.id;plan.allocations=other;}
    else {
      const resourceId=command.resourceId,days=command.action==='replace'?old!.days:command.days;eligible(demand,resourceId);
      if(other.some(item=>item.demandId===demand.id&&item.resourceId===resourceId))fail(409,'Cette ressource possède déjà une affectation sur la demande. Modifiez cette affectation.');
      if(other.filter(item=>item.demandId===demand.id).reduce((total,item)=>total+item.days,0)+days>demand.days+1e-9)fail(400,'Les affectations dépassent les jours demandés.');
      if(command.action==='replace'&&!command.reason)fail(400,'Un motif d’arbitrage est obligatoire.');
      const prospective={...plan,allocations:other};const available=capacityMonthMetrics({...data,capacityPlans:[prospective]},resource(resourceId),demand.month,prospective).real;
      if(!plan.settings.allowOverload&&days>available+1e-9)fail(409,'L’affectation dépasse la capacité disponible. Le PMO a activé le blocage des surcharges.');
      const value={id:old?.id??id(),demandId:demand.id,resourceId,days};plan.allocations=days>0?[...other,value]:other;targetId=value.id;after=days>0?value:null;
    }
  } else if(command.action==='go') {
    projectManager(command.projectId);const demands=plan.demands.filter(item=>item.projectId===command.projectId);if(!demands.length)fail(409,'Créez au moins une demande avant de figer la photo au Go.');
    plan.demands=plan.demands.map(item=>item.projectId===command.projectId?{...item,status:'go',updatedAt:at}:item);
    const baseline={id:id(),projectId:command.projectId,at,demands:structuredClone(plan.demands.filter(item=>item.projectId===command.projectId))};plan.baselines.push(baseline);targetId=baseline.id;after=baseline;
  }
  plan.audit.push({id:id(),at,actorId:data.currentUser.id,actorName:data.currentUser.name,action:command.action,targetId,before:JSON.stringify(before),after:JSON.stringify(after),reason});
  if(!capacityPlanRecord.safeParse(plan).success)fail(413,'Le module capacitaire a atteint une limite de stockage ou de journalisation. Exportez le journal ; aucun historique n’a été supprimé.');
  store.put('capacityPlans',plan);return plan;
}
