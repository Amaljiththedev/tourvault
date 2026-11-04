"""S3-compatible object storage for 3D asset files.

Works with RustFS/MinIO locally and AWS S3 in production:
only the endpoint and credentials change, set through environment variables.
"""
import os

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

# On AWS these are set to empty strings, which become None: boto3 then uses the
# real S3 endpoint and its default credential chain, which picks up the EC2
# instance role, so no access keys are stored anywhere.
S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://localhost:9000") or None
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "minioadmin") or None
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "minioadmin") or None
S3_BUCKET = os.getenv("S3_BUCKET", "tour-assets")
S3_REGION = os.getenv("AWS_REGION", "us-east-1")
# The address clients use to download. In docker compose the API reaches storage
# as http://storage:9000, but a browser cannot, and the host is part of the signature.
S3_PUBLIC_ENDPOINT = os.getenv("S3_PUBLIC_ENDPOINT", S3_ENDPOINT) or None


def _client(endpoint: str | None):
    # On real AWS, sign for the regional host (bucket.s3.<region>.amazonaws.com).
    # Links signed for the global s3.amazonaws.com host fail with
    # SignatureDoesNotMatch for buckets outside us-east-1.
    config = Config(s3={"addressing_style": "virtual"}) if endpoint is None else None
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
        region_name=S3_REGION,
        config=config,
    )


s3 = _client(S3_ENDPOINT)
s3_public = _client(S3_PUBLIC_ENDPOINT)


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
    return s3_public.generate_presigned_url(
        "get_object",
        Params={"Bucket": S3_BUCKET, "Key": object_key},
        ExpiresIn=expires_seconds,
    )


def read_start(object_key: str, num_bytes: int = 64 * 1024) -> bytes:
    """Download only the FIRST num_bytes of a file (an HTTP Range request).

    A PLY header is at the very top, so 64 KB is plenty, even for a
    multi-gigabyte scan. We never download the whole file just to read the header.
    """
    response = s3.get_object(
        Bucket=S3_BUCKET,
        Key=object_key,
        Range=f"bytes=0-{num_bytes - 1}",
    )
    return response["Body"].read()


def delete_file(object_key: str) -> None:
    s3.delete_object(Bucket=S3_BUCKET, Key=object_key)
