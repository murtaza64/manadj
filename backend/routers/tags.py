"""API routes for tags."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from .. import crud, schemas
from ..database import get_db

router = APIRouter()


@router.get("/categories", response_model=List[schemas.TagCategory])
def list_categories(db: Session = Depends(get_db)):
    return crud.get_tag_categories(db)


@router.get("/categories/{category_id}/tags", response_model=List[schemas.Tag])
def list_tags(category_id: int, db: Session = Depends(get_db)):
    return crud.get_tags_by_category(db, category_id)


@router.get("/", response_model=List[schemas.Tag])
def list_all_tags(db: Session = Depends(get_db)):
    return crud.get_all_tags(db)


@router.post("/categories", response_model=schemas.TagCategory, status_code=201)
def create_category(category: schemas.TagCategoryCreate, db: Session = Depends(get_db)):
    return crud.create_tag_category(db, category)


@router.post("/", response_model=schemas.Tag, status_code=201)
def create_tag(tag: schemas.TagCreate, db: Session = Depends(get_db)):
    return crud.create_tag(db, tag)


@router.patch("/{tag_id}", response_model=schemas.Tag)
def update_tag(
    tag_id: int,
    tag_update: schemas.TagUpdate,
    db: Session = Depends(get_db)
):
    tag = crud.update_tag(db, tag_id, tag_update)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    return tag


@router.delete("/{tag_id}", status_code=204)
def delete_tag(tag_id: int, db: Session = Depends(get_db)):
    result = crud.delete_tag(db, tag_id)
    if not result:
        raise HTTPException(status_code=404, detail="Tag not found")
    return None


@router.post("/reorder", status_code=200)
def reorder_tags(
    tag_order: List[dict],
    db: Session = Depends(get_db)
):
    crud.reorder_tags(db, tag_order)
    return {"message": "Tags reordered successfully"}
