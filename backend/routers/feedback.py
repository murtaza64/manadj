"""Feedback HTTP boundary; standalone tests need neither main nor the app DB."""

import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from ..feedback import REQUEST_LIMIT, Dispatch, FeedbackService, Submission
from ..feedback_transport import loopback_url


def protect(request: Request, response: Response):
    origin = request.headers.get("origin")
    if origin is not None and not loopback_url(origin):
        raise HTTPException(403, "Feedback is accessible only from loopback origins")
    if request.headers.get("x-manadj-feedback") != "1":
        raise HTTPException(403, "X-Manadj-Feedback: 1 is required")
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"


router = APIRouter(prefix="/api/feedback", tags=["feedback"], dependencies=[Depends(protect)])


def service(request: Request) -> FeedbackService:
    return request.app.state.feedback_service


async def payload(request: Request, model):
    if request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
        raise HTTPException(415, "Feedback requires application/json")
    try:
        if int(request.headers.get("content-length", "0")) > REQUEST_LIMIT:
            raise HTTPException(413, "Feedback request is too large")
    except ValueError:
        raise HTTPException(400, "Invalid content length") from None
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > REQUEST_LIMIT:
            raise HTTPException(413, "Feedback request is too large")
    try:
        return model.model_validate(json.loads(data))
    except (ValueError, ValidationError, RecursionError):
        # Validation errors echo offending values by default (possibly secrets).
        raise HTTPException(
            422, "Invalid feedback input; check field, attachment and size limits"
        ) from None


@router.get("/context")
def context(request: Request):
    return service(request).context()


@router.get("/reports")
def reports(request: Request):
    return service(request).list()


@router.post("/reports")
async def submit(request: Request):
    return await run_in_threadpool(service(request).submit, await payload(request, Submission))


@router.get("/reports/{id}")
def evidence(id: UUID, request: Request):
    return service(request).evidence(str(id))


@router.post("/reports/{id}/retry")
def retry_report(id: UUID, request: Request):
    return service(request).retry_report(str(id))


@router.post("/dispatch")
async def dispatch(request: Request):
    return await run_in_threadpool(service(request).dispatch, await payload(request, Dispatch))


@router.post("/batches/{id}/retry")
def retry_batch(id: UUID, request: Request):
    return service(request).retry_batch(str(id))
