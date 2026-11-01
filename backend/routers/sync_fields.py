"""Field-only read plan and guarded synchronous execution."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.export_gate import require_export_enabled
from backend.field_review import FieldPlanUnavailable, FieldReviewBusy, FieldReviewRequest, StaleFieldPlan

router = APIRouter(prefix='/sync/fields', tags=['sync'])


def get_field_review(db: Session = Depends(get_db)):
    from backend.field_review_adapters import build_field_review
    return build_field_review(db)


class Replacement(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    track_id: int
    field: str


class ExecuteFields(FieldReviewRequest):
    token: str
    replacements: list[Replacement]


@router.post('/plan')
def plan(request: FieldReviewRequest, service=Depends(get_field_review)):
    try:
        return service.preview(request)
    except FieldPlanUnavailable as error:
        raise HTTPException(409, {'code': 'plan_unavailable', 'message': str(error)}) from error


@router.post('/execute')
def execute(request: ExecuteFields, service=Depends(get_field_review)):
    if request.direction == 'export':
        require_export_enabled()
    try:
        context = FieldReviewRequest.model_validate(request.model_dump(exclude={'token', 'replacements'}))
        return service.execute(context, request.token, [(r.track_id, r.field) for r in request.replacements])
    except (FieldPlanUnavailable, StaleFieldPlan, FieldReviewBusy) as error:
        code = 'stale_plan' if isinstance(error, StaleFieldPlan) else 'operation_pending' if isinstance(error, FieldReviewBusy) else 'plan_unavailable'
        raise HTTPException(409, {'code': code, 'message': str(error)}) from error
