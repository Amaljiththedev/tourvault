"""S3-compatible object storage for 3D asset files.

Works with RustFS/MinIO locally and AWS S3 in production:
only the endpoint and credentials change, set through environment variables.
"""
import os

import boto3
from botocore.exceptions import ClientError

S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://localhost:9000")
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "minioadmin")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "minioadmin")
S3_BUCKET = os.getenv("S3_BUCKET", "tour-assets")

s3 = boto3.client(
    "s3",
    endpoint_url=S3_ENDPOINT,
    aws_access_key_id=S3_ACCESS_KEY,
    aws_secret_access_key=S3_SECRET_KEY,
    region_name="us-east-1",
)


def ensure_bucket() -> None:
    """Create the bucket if it does not exist yet."""
    try:
        s3.head_bucket(Bucket=S3_BUCKET)
    except ClientError:
        s3.create_bucket(Bucket=S3_BUCKET)


def upload_file(fileobj, object_key: str, content_type: str | None) -> None:
    """Stream a file-like object into the bucket under object_key."""
    extra = {"ContentType": content_type} if content_type else {}
    s3.upload_fileobj(fileobj, S3_BUCKET, object_key, ExtraArgs=extra)


def presigned_download_url(object_key: str, expires_seconds: int = 600) -> str:
    """A temporary signed link that lets a client download straight from storage."""
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": S3_BUCKET, "Key": object_key},
        ExpiresIn=expires_seconds,
    )
